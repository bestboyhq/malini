import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
	ipcMain: { handle: vi.fn() },
	BrowserWindow: { getAllWindows: () => [] },
}));

import type { ExtensionChangedEvent } from '$contract/marketplace';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { createEventBus } from '$main/events';
import { initRealRepo, realGit } from '$main/git/fixtures.test-support';
import type { BestboyAccess, BestboySession } from '$lib/stats/stats.platform';
import { packExtension, sha256Of, type PackageFile } from './extension-package';
import { Marketplace, type PublishSource } from './marketplace';
import { MarketplaceClient } from './marketplace-client';

const ORIGIN = 'https://bestboy.test';

let root: string;
let db: MaliniDatabase;
let platform: FakePlatform;
let session: BestboySession | null;
let signedOut: number;
let changes: ExtensionChangedEvent[];
let sources: PublishSource[];
let marketplace: Marketplace;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'malini-marketplace-'));
	db = openMigratedDatabase(':memory:');
	platform = fakePlatform();
	session = null;
	signedOut = 0;
	changes = [];
	sources = [];
	marketplace = build();
});

afterEach(async () => {
	db.close();
	await rm(root, { recursive: true, force: true });
});

function build(): Marketplace {
	const events = createEventBus({ forwardToWindows: false });
	events.subscribe('extensions:changed', (change) => changes.push(change));
	const access = (): BestboyAccess => ({
		origin: ORIGIN,
		fetch: platform.fetch,
		session: () => session,
		claimHandle: () => Promise.resolve(null),
		signedOut: () => {
			signedOut += 1;
			return Promise.resolve();
		},
	});
	return new Marketplace({
		db,
		events,
		root: join(root, 'extensions'),
		client: new MarketplaceClient(access),
		bestboy: access,
		sources: () => Promise.resolve(sources),
	});
}

describe('installing', () => {
	it('unpacks the listed version as a Claude Code plugin every session loads', async () => {
		platform.publish(svelte('1.0.4'));

		const installed = await marketplace.install('szymeo', 'svelte');

		expect(installed).toMatchObject({ version: '1.0.4', enabled: true, skills: ['runes'] });
		const [folder] = marketplace.pluginFolders();
		expect(folder).toBe(join(root, 'extensions', 'installed', 'svelte@1.0.4'));
		expect(await text(folder, 'skills/runes/SKILL.md')).toContain('Use runes.');
		expect(JSON.parse(await text(folder, '.claude-plugin/plugin.json'))).toEqual({
			name: 'svelte',
			version: '1.0.4',
			description: 'Svelte docs and skills.',
		});
		expect(JSON.parse(await text(folder, '.mcp.json'))).toEqual({
			mcpServers: { svelte: { type: 'http', url: 'https://mcp.svelte.dev/mcp' } },
		});
		expect(changes).toEqual([
			{ publisher: 'szymeo', name: 'svelte', version: '1.0.4', change: 'installed' },
		]);
	});

	it('refuses bytes that are not the ones the marketplace listed', async () => {
		platform.publish(svelte('1.0.4'), { sha256: 'f'.repeat(64) });

		await expect(marketplace.install('szymeo', 'svelte')).rejects.toThrow(
			'Svelte 1.0.4 does not match what the marketplace listed.',
		);
		expect(marketplace.installed()).toEqual([]);
		expect(existsSync(join(root, 'extensions', 'installed', 'svelte@1.0.4'))).toBe(false);
	});

	it('refuses a package that holds a different version than its listing', async () => {
		platform.publish(svelte('1.0.4'), { listedVersion: '1.0.5' });

		await expect(marketplace.install('szymeo', 'svelte')).rejects.toThrow(
			'Svelte 1.0.5 holds a different extension.',
		);
	});

	it('keeps one extension per name', async () => {
		platform.publish(svelte('1.0.4'));
		platform.publish(svelte('2.0.0', 'someone'));
		await marketplace.install('szymeo', 'svelte');

		await expect(marketplace.install('someone', 'svelte')).rejects.toThrow(
			'Svelte by @szymeo is installed under the name svelte. Uninstall it first.',
		);
	});

	it('hands an agent at most 50 extensions', async () => {
		for (let index = 0; index < 51; index += 1) {
			platform.publish(svelte('1.0.0', 'szymeo', undefined, `tools-${index}`));
		}
		for (let index = 0; index < 50; index += 1)
			await marketplace.install('szymeo', `tools-${index}`);

		await expect(marketplace.install('szymeo', 'tools-50')).rejects.toThrow(
			'An agent gets at most 50 extensions. Turn one off first.',
		);
		await marketplace.switch('tools-0', false);
		await marketplace.install('szymeo', 'tools-50');
		await expect(marketplace.switch('tools-0', true)).rejects.toThrow('Turn one off first.');
	});

	it('turns off, back on and uninstalls', async () => {
		platform.publish(svelte('1.0.4'));
		await marketplace.install('szymeo', 'svelte');

		await marketplace.switch('svelte', false);
		expect(marketplace.pluginFolders()).toEqual([]);
		await marketplace.switch('svelte', true);
		expect(marketplace.pluginFolders()).toHaveLength(1);
		await marketplace.uninstall('svelte');

		expect(marketplace.installed()).toEqual([]);
		expect(existsSync(join(root, 'extensions', 'installed', 'svelte@1.0.4'))).toBe(false);
		expect(changes.map(({ change }) => change)).toEqual([
			'installed',
			'turned-off',
			'turned-on',
			'uninstalled',
		]);
	});
});

describe('following the marketplace', () => {
	it('installs a newer version that reaches no new host, in a folder of its own', async () => {
		platform.publish(svelte('1.0.4'));
		await marketplace.install('szymeo', 'svelte');
		platform.publish(svelte('1.0.5'));

		await settledIndex(build());

		expect(marketplace.installed()[0]?.version).toBe('1.0.5');
		expect(marketplace.pluginFolders()).toEqual([
			join(root, 'extensions', 'installed', 'svelte@1.0.5'),
		]);
		expect(changes.at(-1)).toMatchObject({ version: '1.0.5', change: 'updated' });
	});

	it('leaves a version that reaches a new host for you to update', async () => {
		platform.publish(svelte('1.0.4'));
		await marketplace.install('szymeo', 'svelte');
		platform.publish(
			svelte('1.1.0', 'szymeo', {
				svelte: 'https://mcp.svelte.dev/mcp',
				kit: 'https://kit.dev/mcp',
			}),
		);

		await settledIndex(build());

		expect(marketplace.installed()[0]?.version).toBe('1.0.4');
	});

	it('turns off a version its publisher withdrew', async () => {
		platform.publish(svelte('1.0.4'));
		await marketplace.install('szymeo', 'svelte');
		platform.yank('szymeo', 'svelte', '1.0.4');

		await settledIndex(build());

		expect(marketplace.installed()[0]).toMatchObject({ enabled: false, withdrawn: true });
		expect(marketplace.pluginFolders()).toEqual([]);
		await expect(marketplace.switch('svelte', true)).rejects.toThrow(
			'Its publisher withdrew Svelte 1.0.4.',
		);
	});

	it('says why when bestboy.dev cannot be reached and it never saw a list', async () => {
		platform.offline = true;

		expect(await marketplace.listings()).toEqual({
			listings: [],
			unreachable: 'Malini could not reach bestboy.test: offline.',
		});
	});

	it('shows the last list it saw when bestboy.dev cannot be reached', async () => {
		platform.publish(svelte('1.0.4'));
		expect((await marketplace.listings()).unreachable).toBeNull();
		platform.offline = true;

		const listings = await build().listings();

		expect(listings.unreachable).toBe('Malini could not reach bestboy.test: offline.');
		expect(listings.listings.map(({ name }) => name)).toEqual(['svelte']);
	});
});

describe('publishing', () => {
	it('uploads what is committed under your handle', async () => {
		const repository = await extensionRepository('1.0.4');
		session = { token: 'token-1', handle: 'szymeo' };

		const listing = await marketplace.publish('local:svelte');

		expect(listing).toMatchObject({ publisher: 'szymeo', name: 'svelte', version: '1.0.4' });
		const [upload] = platform.uploads;
		expect(upload?.authorization).toBe('Bearer token-1');
		expect(upload?.files.map(({ path }) => path).sort()).toEqual([
			'README.md',
			'malini.json',
			'skills/runes/SKILL.md',
		]);
		expect(repository).toBeTruthy();
	});

	it('refuses uncommitted changes', async () => {
		const repository = await extensionRepository('1.0.4');
		await writeFile(join(repository, 'skills/runes/SKILL.md'), 'changed');
		session = { token: 'token-1', handle: 'szymeo' };

		await expect(marketplace.publish('local:svelte')).rejects.toThrow(
			'Commit malini.json, README.md, LICENSE and skills/ first: Malini publishes what is committed.',
		);
	});

	it('refuses a malini.json that names someone else', async () => {
		await extensionRepository('1.0.4');
		session = { token: 'token-1', handle: 'another' };

		await expect(marketplace.publish('local:svelte')).rejects.toThrow(
			'malini.json names publisher szymeo, and you publish as @another.',
		);
	});

	it('asks you to sign in again when bestboy.dev drops the token', async () => {
		await extensionRepository('1.0.4');
		session = { token: 'revoked', handle: 'szymeo' };
		platform.refuseUploads = 401;

		await expect(marketplace.publish('local:svelte')).rejects.toThrow(
			'Sign in to Bestboy again, then publish.',
		);
		expect(signedOut).toBe(1);
	});

	it('asks bestboy.dev nothing while no repository has a malini.json', async () => {
		sources = [{ id: 'local:plain', fullName: 'szymeo/plain', dir: root }];
		session = { token: 'token-1', handle: 'szymeo' };
		const reads = vi.spyOn(platform, 'fetch');

		expect(await marketplace.publishing()).toEqual({
			signedIn: true,
			handle: 'szymeo',
			extensions: [],
		});
		expect(reads).not.toHaveBeenCalled();
	});

	it('lists your repositories with a malini.json and what blocks each', async () => {
		await extensionRepository('1.0.4');
		platform.publish(svelte('1.0.4'));
		session = { token: 'token-1', handle: 'szymeo' };

		expect(await marketplace.publishing()).toEqual({
			signedIn: true,
			handle: 'szymeo',
			extensions: [
				{
					repositoryId: 'local:svelte',
					repository: 'szymeo/svelte',
					name: 'svelte',
					displayName: 'Svelte',
					version: '1.0.4',
					liveVersion: '1.0.4',
					problem: 'Raise version above 1.0.4 in malini.json to publish.',
				},
			],
		});
	});
});

async function settledIndex(other: Marketplace): Promise<void> {
	await other.refresh();
}

async function extensionRepository(version: string): Promise<string> {
	const repository = join(root, 'svelte');
	await initRealRepo(repository);
	for (const file of svelte(version)) {
		await mkdir(join(repository, file.path, '..'), { recursive: true });
		await writeFile(join(repository, file.path), file.bytes);
	}
	await realGit(repository, ['add', '.']);
	await realGit(repository, ['commit', '-q', '-m', 'Svelte extension']);
	sources = [{ id: 'local:svelte', fullName: 'szymeo/svelte', dir: repository }];
	return repository;
}

function svelte(
	version: string,
	publisher = 'szymeo',
	servers: Readonly<Record<string, string>> = { svelte: 'https://mcp.svelte.dev/mcp' },
	name = 'svelte',
): PackageFile[] {
	const manifest = {
		apiVersion: 2,
		publisher,
		name,
		version,
		displayName: 'Svelte',
		description: 'Svelte docs and skills.',
		contributes: {
			mcpServers: Object.fromEntries(Object.entries(servers).map(([name, url]) => [name, { url }])),
		},
	};
	return [
		{ path: 'malini.json', bytes: Buffer.from(JSON.stringify(manifest)) },
		{ path: 'README.md', bytes: Buffer.from('# Svelte') },
		{ path: 'skills/runes/SKILL.md', bytes: Buffer.from('---\nname: runes\n---\nUse runes.') },
	];
}

function text(folder: string | undefined, path: string): Promise<string> {
	if (!folder) throw new Error('no folder');
	return readFile(join(folder, path), 'utf8');
}

type Upload = Readonly<{ authorization: string | null; files: readonly PackageFile[] }>;

type Published = Readonly<{ listing: Record<string, unknown>; bytes: Buffer }>;

type FakePlatform = {
	fetch: BestboyAccess['fetch'];
	publish(files: PackageFile[], options?: { sha256?: string; listedVersion?: string }): void;
	yank(publisher: string, name: string, version: string): void;
	uploads: Upload[];
	offline: boolean;
	refuseUploads: number | null;
};

function fakePlatform(): FakePlatform {
	const published = new Map<string, Published>();
	const yanked: { publisher: string; name: string; version: string }[] = [];
	const httpCache = new Map<string, Response>();
	const state: FakePlatform = {
		uploads: [],
		offline: false,
		refuseUploads: null,
		publish(files, options = {}) {
			const manifest: unknown = JSON.parse(
				String(files.find((file) => file.path === 'malini.json')?.bytes),
			);
			if (typeof manifest !== 'object' || manifest === null) throw new Error('bad manifest');
			const { publisher, name, version, displayName, description, contributes } = manifest as {
				publisher: string;
				name: string;
				version: string;
				displayName: string;
				description: string;
				contributes: { mcpServers: Record<string, { url: string }> };
			};
			const bytes = packExtension(files);
			published.set(`${publisher}/${name}`, {
				bytes,
				listing: {
					publisher,
					name,
					displayName,
					description,
					version: options.listedVersion ?? version,
					publishedOn: '2026-10-31',
					repository: null,
					mcpServers: Object.entries(contributes.mcpServers).map(([server, { url }]) => ({
						name: server,
						url,
					})),
					skills: ['runes'],
					package: { sha256: options.sha256 ?? sha256Of(bytes), size: bytes.length },
				},
			});
		},
		yank(publisher, name, version) {
			yanked.push({ publisher, name, version });
			if (published.get(`${publisher}/${name}`)?.listing['version'] === version) {
				published.delete(`${publisher}/${name}`);
			}
		},
		fetch: async (url, init) => {
			const kept = init.cache === 'no-cache' ? undefined : httpCache.get(url);
			if (kept) return kept.clone();
			const response = await answer(url, init);
			if ((init.method ?? 'GET') === 'GET' && response.ok) httpCache.set(url, response.clone());
			return response;
		},
	};
	return state;

	async function answer(url: string, init: RequestInit): Promise<Response> {
		if (state.offline) throw new Error('offline');
		const path = new URL(url).pathname;
		const method = init.method ?? 'GET';
		if (method === 'GET' && path === '/api/extensions') {
			return Response.json({
				extensions: [...published.values()].map(({ listing }) => listing),
				yanked,
			});
		}
		const packageMatch = /^\/api\/extensions\/([^/]+)\/([^/]+)\/versions\/[^/]+\/package$/u.exec(
			path,
		);
		if (method === 'GET' && packageMatch) {
			const entry = published.get(`${packageMatch[1]}/${packageMatch[2]}`);
			return entry
				? new Response(new Uint8Array(entry.bytes), {
						headers: { 'content-type': 'application/gzip' },
					})
				: Response.json({ error: 'Not found' }, { status: 404 });
		}
		const publishMatch = /^\/api\/extensions\/([^/]+)\/([^/]+)\/versions$/u.exec(path);
		if (method === 'POST' && publishMatch) {
			if (state.refuseUploads) {
				return Response.json({ error: 'Signed out' }, { status: state.refuseUploads });
			}
			const body = init.body;
			if (!(body instanceof Uint8Array)) throw new Error('expected bytes');
			const { readExtensionPackage } = await import('./extension-package');
			const read = readExtensionPackage(Buffer.from(body));
			const headers = new Headers(init.headers);
			state.uploads.push({ authorization: headers.get('authorization'), files: read.files });
			state.publish([...read.files]);
			return Response.json(published.get(`${publishMatch[1]}/${publishMatch[2]}`)?.listing, {
				status: 201,
			});
		}
		const detailMatch = /^\/api\/extensions\/([^/]+)\/([^/]+)$/u.exec(path);
		if (method === 'GET' && detailMatch) {
			const entry = published.get(`${detailMatch[1]}/${detailMatch[2]}`);
			return entry
				? Response.json({ ...entry.listing, readme: '# Svelte', versions: [] })
				: Response.json({ error: 'Not found' }, { status: 404 });
		}
		return Response.json({ error: 'Not found' }, { status: 404 });
	}
}
