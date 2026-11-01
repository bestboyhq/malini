import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
	ExtensionChange,
	ExtensionDetail,
	ExtensionListing,
	InstalledExtension,
	MarketplaceListings,
	PublishableExtension,
	Publishing,
} from '$contract/marketplace';
import { EXTENSIONS_CHANGED_CHANNEL, EXTENSIONS_PUBLISHED_CHANNEL } from '$contract/events';
import type { MaliniDatabase } from '$main/db/driver';
import { isRecord, nowIso8601 } from '$main/db/rows';
import type { EventBus } from '$main/events';
import { runGit } from '$main/git/run';
import { BestboyError, type BestboyAccess } from '$lib/stats/stats.platform';
import {
	LICENSE_FILE,
	MANIFEST_FILE,
	README_FILE,
	isNewerVersion,
	readMarketplaceManifest,
	serverHosts,
} from '../domain/marketplace-manifest';
import {
	extensionFrom,
	packExtension,
	readExtensionPackage,
	sha256Of,
	type ExtensionPackage,
	type PackageFile,
} from './extension-package';
import {
	deleteInstalledExtension,
	getInstalledExtension,
	listInstalledExtensions,
	saveInstalledExtension,
	switchInstalledExtension,
	withdrawInstalledExtension,
	type InstalledExtensionRecord,
} from './installed-extensions.repository';
import type { MarketplaceClient, MarketplaceIndex, MarketplaceListing } from './marketplace-client';

export type PublishSource = Readonly<{ id: string; fullName: string; dir: string }>;

export type MarketplaceDeps = Readonly<{
	db: MaliniDatabase;
	events: EventBus;
	root: string;
	client: MarketplaceClient;
	bestboy: () => BestboyAccess;
	sources: () => Promise<readonly PublishSource[]>;
}>;

const ENABLED_MAX = 50;
const PUBLISHED_PATHS = [MANIFEST_FILE, README_FILE, LICENSE_FILE, 'skills'];

export class Marketplace {
	readonly #deps: MarketplaceDeps;
	#index: MarketplaceIndex | null = null;
	#queue: Promise<unknown> = Promise.resolve();
	#following: Promise<unknown> = Promise.resolve();
	#unreachable: string | null = null;

	constructor(deps: MarketplaceDeps) {
		this.#deps = deps;
	}

	async listings(): Promise<MarketplaceListings> {
		const fresh = await this.#freshIndex();
		const index = fresh ?? this.#index ?? (await this.#savedIndex());
		return {
			listings: (index?.listings ?? []).map(withoutPackage),
			unreachable: fresh ? null : this.#unreachable,
		};
	}

	async detail(publisher: string, name: string): Promise<ExtensionDetail> {
		const detail = await this.#deps.client.detail(publisher, name);
		return { ...detail, listing: withoutPackage(detail.listing) };
	}

	installed(): InstalledExtension[] {
		return listInstalledExtensions(this.#deps.db).map(withoutSha);
	}

	install(publisher: string, name: string): Promise<InstalledExtension> {
		return this.#serial(async () => {
			const listing = await this.#listing(publisher, name);
			return withoutSha(await this.#install(listing));
		});
	}

	uninstall(name: string): Promise<void> {
		return this.#serial(async () => {
			const installed = this.#requireInstalled(name);
			await this.#removeFolders(name, []);
			deleteInstalledExtension(this.#deps.db, name);
			this.#changed(installed, 'uninstalled');
		});
	}

	switch(name: string, enabled: boolean): Promise<InstalledExtension> {
		return this.#serial(async () => {
			const installed = this.#requireInstalled(name);
			if (enabled && installed.withdrawn) {
				throw new Error(`Its publisher withdrew ${installed.displayName} ${installed.version}.`);
			}
			if (enabled) this.#requireRoom(name);
			switchInstalledExtension(this.#deps.db, name, enabled);
			this.#changed(installed, enabled ? 'turned-on' : 'turned-off');
			return withoutSha({ ...installed, enabled });
		});
	}

	pluginFolders(): string[] {
		return listInstalledExtensions(this.#deps.db)
			.filter((extension) => extension.enabled && !extension.withdrawn)
			.map((extension) => this.#folder(extension.name, extension.version))
			.filter((folder) => existsSync(folder));
	}

	async refresh(): Promise<void> {
		if (listInstalledExtensions(this.#deps.db).length === 0) return;
		await this.#freshIndex();
		await this.#following;
	}

	async publishing(): Promise<Publishing> {
		const session = this.#deps.bestboy().session();
		const handle = session?.handle ?? null;
		const sources = (await this.#deps.sources()).filter((source) =>
			existsSync(join(source.dir, MANIFEST_FILE)),
		);
		const index =
			sources.length === 0
				? null
				: ((await this.#freshIndex()) ?? this.#index ?? (await this.#savedIndex()));
		const extensions: PublishableExtension[] = [];
		for (const source of sources) extensions.push(await publishable(source, handle, index));
		return { signedIn: session !== null, handle, extensions };
	}

	async publish(repositoryId: string): Promise<ExtensionListing> {
		const session = this.#deps.bestboy().session();
		if (!session) throw new Error('Sign in to Bestboy first.');
		if (!session.handle) throw new Error('Pick your handle first: you publish under it.');
		const source = (await this.#deps.sources()).find((each) => each.id === repositoryId);
		if (!source) throw new Error('Malini has no checkout of that repository.');
		const extension = extensionFrom(await committedFiles(source.dir));
		const { publisher, name, version } = extension.manifest;
		if (publisher !== session.handle) {
			throw new Error(
				`malini.json names publisher ${publisher}, and you publish as @${session.handle}.`,
			);
		}
		let listing: MarketplaceListing;
		try {
			listing = await this.#deps.client.publish(
				session.token,
				publisher,
				name,
				packExtension(extension.files),
			);
		} catch (error) {
			if (error instanceof BestboyError && error.signedOut) {
				await this.#deps.bestboy().signedOut();
				throw new Error('Sign in to Bestboy again, then publish.');
			}
			throw error;
		}
		this.#remember(listing);
		this.#deps.events.emit(EXTENSIONS_PUBLISHED_CHANNEL, {
			publisher,
			name,
			version,
			repository: source.fullName,
		});
		return withoutPackage(listing);
	}

	async #install(listing: MarketplaceListing): Promise<InstalledExtensionRecord> {
		const { db } = this.#deps;
		const current = getInstalledExtension(db, listing.name);
		if (current && current.publisher !== listing.publisher) {
			throw new Error(
				`${current.displayName} by @${current.publisher} is installed under the name ${listing.name}. Uninstall it first.`,
			);
		}
		if (!current) this.#requireRoom(listing.name);
		const bytes = await this.#deps.client.download(listing);
		if (sha256Of(bytes) !== listing.package.sha256) {
			throw new Error(
				`${listing.displayName} ${listing.version} does not match what the marketplace listed.`,
			);
		}
		const extension = readExtensionPackage(bytes);
		const { publisher, name, version } = extension.manifest;
		if (publisher !== listing.publisher || name !== listing.name || version !== listing.version) {
			throw new Error(`${listing.displayName} ${listing.version} holds a different extension.`);
		}
		await this.#unpack(extension, current?.version ?? null);
		const record: InstalledExtensionRecord = {
			publisher,
			name,
			version,
			displayName: extension.manifest.displayName,
			description: extension.manifest.description,
			repository: extension.manifest.repository,
			mcpServers: extension.manifest.mcpServers,
			skills: extension.skills,
			sha256: listing.package.sha256,
			enabled: current?.enabled ?? true,
			withdrawn: false,
			installedAt: nowIso8601(),
		};
		saveInstalledExtension(db, record);
		this.#changed(record, current ? 'updated' : 'installed');
		return record;
	}

	async #unpack(extension: ExtensionPackage, previousVersion: string | null): Promise<void> {
		const { name, version } = extension.manifest;
		const installedRoot = join(this.#deps.root, 'installed');
		const staging = join(installedRoot, `.staging-${randomUUID()}`);
		const trash = join(installedRoot, `.trash-${randomUUID()}`);
		const target = this.#folder(name, version);
		try {
			for (const file of [...extension.files, ...pluginFiles(extension)]) {
				const path = join(staging, ...file.path.split('/'));
				await mkdir(dirname(path), { recursive: true });
				await writeFile(path, file.bytes);
			}
			if (existsSync(target)) await rename(target, trash);
			await rename(staging, target);
		} finally {
			await rm(staging, { recursive: true, force: true });
			await rm(trash, { recursive: true, force: true });
		}
		const kept = [target, previousVersion ? this.#folder(name, previousVersion) : null];
		await this.#removeFolders(
			name,
			kept.filter((folder): folder is string => folder !== null),
		);
	}

	async #removeFolders(name: string, kept: readonly string[]): Promise<void> {
		const installedRoot = join(this.#deps.root, 'installed');
		const entries = await readdir(installedRoot).catch(() => []);
		for (const entry of entries) {
			const folder = join(installedRoot, entry);
			if (!entry.startsWith(`${name}@`) || kept.includes(folder)) continue;
			await rm(folder, { recursive: true, force: true });
		}
	}

	#requireRoom(name: string): void {
		const enabled = listInstalledExtensions(this.#deps.db).filter(
			(extension) => extension.enabled && !extension.withdrawn && extension.name !== name,
		);
		if (enabled.length >= ENABLED_MAX) {
			throw new Error(`An agent gets at most ${ENABLED_MAX} extensions. Turn one off first.`);
		}
	}

	async #listing(publisher: string, name: string): Promise<MarketplaceListing> {
		const index = (await this.#freshIndex()) ?? this.#index;
		const listed = index?.listings.find(
			(listing) => listing.publisher === publisher && listing.name === name,
		);
		return listed ?? (await this.#deps.client.detail(publisher, name)).listing;
	}

	async #freshIndex(): Promise<MarketplaceIndex | null> {
		let index: MarketplaceIndex;
		try {
			index = await this.#deps.client.index();
		} catch (error) {
			this.#unreachable = error instanceof Error ? error.message : String(error);
			return null;
		}
		this.#index = index;
		await this.#saveIndex(index);
		this.#following = this.#serial(() => this.#followIndex(index)).catch(() => undefined);
		return index;
	}

	async #followIndex(index: MarketplaceIndex): Promise<void> {
		const { db } = this.#deps;
		for (const installed of listInstalledExtensions(db)) {
			const yanked = index.yanked.some(
				(entry) =>
					entry.publisher === installed.publisher &&
					entry.name === installed.name &&
					entry.version === installed.version,
			);
			if (yanked && !installed.withdrawn) {
				withdrawInstalledExtension(db, installed.name);
				this.#changed(installed, 'withdrawn');
				continue;
			}
			const latest = index.listings.find(
				(listing) => listing.publisher === installed.publisher && listing.name === installed.name,
			);
			if (!latest || !isNewerVersion(latest.version, installed.version)) continue;
			if (widens(installed, latest)) continue;
			await this.#install(latest).catch(() => null);
		}
	}

	#remember(listing: MarketplaceListing): void {
		if (!this.#index) return;
		const listings = this.#index.listings.filter(
			(each) => each.publisher !== listing.publisher || each.name !== listing.name,
		);
		this.#index = { ...this.#index, listings: [...listings, listing] };
	}

	async #savedIndex(): Promise<MarketplaceIndex | null> {
		try {
			const saved: unknown = JSON.parse(await readFile(this.#indexFile(), 'utf8'));
			if (!isRecord(saved) || !Array.isArray(saved['listings'])) return null;
			const listings: readonly MarketplaceListing[] = saved['listings'];
			const yanked = Array.isArray(saved['yanked']) ? saved['yanked'] : [];
			return { listings, yanked };
		} catch {
			return null;
		}
	}

	async #saveIndex(index: MarketplaceIndex): Promise<void> {
		await mkdir(this.#deps.root, { recursive: true });
		const temporary = `${this.#indexFile()}.${randomUUID()}.tmp`;
		await writeFile(temporary, JSON.stringify({ listings: index.listings, yanked: index.yanked }));
		await rename(temporary, this.#indexFile());
	}

	#requireInstalled(name: string): InstalledExtensionRecord {
		const installed = getInstalledExtension(this.#deps.db, name);
		if (!installed) throw new Error(`${name} is not installed.`);
		return installed;
	}

	#changed(extension: InstalledExtensionRecord, change: ExtensionChange): void {
		this.#deps.events.emit(EXTENSIONS_CHANGED_CHANNEL, {
			publisher: extension.publisher,
			name: extension.name,
			version: extension.version,
			change,
		});
	}

	#folder(name: string, version: string): string {
		return join(this.#deps.root, 'installed', `${name}@${version}`);
	}

	#indexFile(): string {
		return join(this.#deps.root, 'index.json');
	}

	#serial<T>(work: () => Promise<T>): Promise<T> {
		const previous = this.#queue;
		const next = (async (): Promise<T> => {
			await previous.catch(() => undefined);
			return work();
		})();
		this.#queue = next;
		return next;
	}
}

async function publishable(
	source: PublishSource,
	handle: string | null,
	index: MarketplaceIndex | null,
): Promise<PublishableExtension> {
	const base = { repositoryId: source.id, repository: source.fullName };
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(join(source.dir, MANIFEST_FILE), 'utf8'));
	} catch {
		return { ...base, ...UNREAD, problem: 'malini.json is not valid JSON.' };
	}
	const reading = readMarketplaceManifest(parsed);
	if (reading.problem) return { ...base, ...UNREAD, problem: reading.problem.error };
	const { publisher, name, displayName, version } = reading.manifest;
	const live = index?.listings.find(
		(listing) => listing.publisher === publisher && listing.name === name,
	);
	const shown = { ...base, name, displayName, version, liveVersion: live?.version ?? null };
	if (handle && publisher !== handle) {
		return {
			...shown,
			problem: `malini.json names publisher ${publisher}; you publish as @${handle}.`,
		};
	}
	if (live && !isNewerVersion(version, live.version)) {
		return { ...shown, problem: `Raise version above ${live.version} in malini.json to publish.` };
	}
	return { ...shown, problem: null };
}

const UNREAD = { name: null, displayName: null, version: null, liveVersion: null } as const;

async function committedFiles(dir: string): Promise<PackageFile[]> {
	const changed = await runGit([
		'-C',
		dir,
		'status',
		'--porcelain',
		'-z',
		'--',
		...PUBLISHED_PATHS,
	]);
	if (changed.length > 0) {
		throw new Error(
			'Commit malini.json, README.md, LICENSE and skills/ first: Malini publishes what is committed.',
		);
	}
	const tracked = await runGit(['-C', dir, 'ls-files', '-z', '--', ...PUBLISHED_PATHS]);
	return Promise.all(
		tracked
			.split('\0')
			.filter((path) => path.length > 0)
			.map(async (path) => ({ path, bytes: await readFile(join(dir, ...path.split('/'))) })),
	);
}

function pluginFiles(extension: ExtensionPackage): PackageFile[] {
	const { name, version, description, mcpServers } = extension.manifest;
	const plugin = {
		path: '.claude-plugin/plugin.json',
		bytes: json({ name, version, description }),
	};
	if (mcpServers.length === 0) return [plugin];
	const servers = Object.fromEntries(
		mcpServers.map((server) => [server.name, { type: 'http', url: server.url }]),
	);
	return [plugin, { path: '.mcp.json', bytes: json({ mcpServers: servers }) }];
}

function json(value: unknown): Buffer {
	return Buffer.from(`${JSON.stringify(value, null, '\t')}\n`);
}

function widens(installed: InstalledExtensionRecord, latest: MarketplaceListing): boolean {
	const hosts = new Set(serverHosts(installed.mcpServers));
	return serverHosts(latest.mcpServers).some((host) => !hosts.has(host));
}

function withoutPackage(listing: MarketplaceListing): ExtensionListing {
	const { package: _package, ...shown } = listing;
	return shown;
}

function withoutSha(record: InstalledExtensionRecord): InstalledExtension {
	const { sha256: _sha256, ...shown } = record;
	return shown;
}
