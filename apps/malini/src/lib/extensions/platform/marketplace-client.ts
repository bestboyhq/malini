import type {
	ExtensionDetail,
	ExtensionListing,
	ExtensionServer,
	ExtensionVersion,
} from '$contract/marketplace';
import { isRecord } from '$main/db/rows';
import { BestboyError, type BestboyAccess } from '$lib/stats/stats.platform';
import { PACKAGE_MAX_BYTES } from './extension-package';

export type MarketplacePackage = Readonly<{ sha256: string; size: number }>;

export type MarketplaceListing = ExtensionListing & Readonly<{ package: MarketplacePackage }>;

export type YankedVersion = Readonly<{ publisher: string; name: string; version: string }>;

export type MarketplaceIndex = Readonly<{
	listings: readonly MarketplaceListing[];
	yanked: readonly YankedVersion[];
}>;

export type MarketplaceDetail = ExtensionDetail & Readonly<{ listing: MarketplaceListing }>;

const REQUEST_TIMEOUT_MS = 15_000;
const PACKAGE_TIMEOUT_MS = 60_000;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const VERSION = /^\d+\.\d+\.\d+$/u;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

export class MarketplaceClient {
	readonly #access: () => BestboyAccess;

	constructor(access: () => BestboyAccess) {
		this.#access = access;
	}

	get host(): string {
		return new URL(this.#access().origin).host;
	}

	async index(): Promise<MarketplaceIndex> {
		const reply = await this.#json('/api/extensions');
		const extensions =
			isRecord(reply) && Array.isArray(reply['extensions']) ? reply['extensions'] : null;
		if (!extensions) throw new BestboyError(`${this.host} sent no extensions.`, 200);
		const yanked = isRecord(reply) && Array.isArray(reply['yanked']) ? reply['yanked'] : [];
		return {
			listings: readArray(extensions).flatMap((value) => listingOf(value) ?? []),
			yanked: readArray(yanked).flatMap((value) => yankedOf(value) ?? []),
		};
	}

	async detail(publisher: string, name: string): Promise<MarketplaceDetail> {
		const reply = await this.#json(`/api/extensions/${publisher}/${name}`);
		const listing = listingOf(reply);
		if (!listing || !isRecord(reply)) {
			throw new BestboyError(`${this.host} sent no extension ${publisher}/${name}.`, 200);
		}
		const readme = reply['readme'];
		const versions = Array.isArray(reply['versions']) ? reply['versions'] : [];
		return {
			listing,
			readme: typeof readme === 'string' ? readme : null,
			versions: readArray(versions).flatMap((value) => versionOf(value) ?? []),
		};
	}

	async download(listing: MarketplaceListing): Promise<Buffer> {
		const { publisher, name, version } = listing;
		const response = await this.#fetch(
			`/api/extensions/${publisher}/${name}/versions/${version}/package`,
			{ method: 'GET' },
			PACKAGE_TIMEOUT_MS,
		);
		if (!response.ok) throw await this.#failure(response);
		const declared = Number(response.headers.get('content-length') ?? '0');
		if (declared > PACKAGE_MAX_BYTES) {
			throw new BestboyError(`${name} ${version} is too large to install.`, 413);
		}
		const bytes = Buffer.from(await response.arrayBuffer());
		if (bytes.length > PACKAGE_MAX_BYTES) {
			throw new BestboyError(`${name} ${version} is too large to install.`, 413);
		}
		return bytes;
	}

	async publish(
		token: string,
		publisher: string,
		name: string,
		bytes: Buffer,
	): Promise<MarketplaceListing> {
		const response = await this.#fetch(
			`/api/extensions/${publisher}/${name}/versions`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/gzip', Authorization: `Bearer ${token}` },
				body: new Uint8Array(bytes),
			},
			PACKAGE_TIMEOUT_MS,
		);
		if (!response.ok) throw await this.#failure(response);
		const listing = listingOf(await response.json().catch(() => null));
		if (!listing)
			throw new BestboyError(`${this.host} published ${name} but sent no listing.`, 200);
		return listing;
	}

	async #json(path: string): Promise<unknown> {
		const response = await this.#fetch(path, { method: 'GET' }, REQUEST_TIMEOUT_MS);
		if (!response.ok) throw await this.#failure(response);
		return response.json().catch(() => null);
	}

	async #fetch(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
		const access = this.#access();
		try {
			return await access.fetch(`${access.origin}${path}`, {
				...init,
				signal: AbortSignal.timeout(timeoutMs),
			});
		} catch (error) {
			throw new BestboyError(`Malini could not reach ${this.host}: ${reason(error)}.`, null);
		}
	}

	async #failure(response: Response): Promise<BestboyError> {
		const reply: unknown = await response.json().catch(() => null);
		const error = isRecord(reply) ? reply['error'] : null;
		const field = isRecord(reply) ? reply['field'] : null;
		return new BestboyError(
			typeof error === 'string' && error.length > 0
				? error
				: `${this.host} answered ${response.status}.`,
			response.status,
			typeof field === 'string' ? field : null,
		);
	}
}

function listingOf(value: unknown): MarketplaceListing | null {
	if (!isRecord(value)) return null;
	const { publisher, name, displayName, description, version, publishedOn, repository } = value;
	const pack = value['package'];
	if (
		!isSlug(publisher) ||
		!isSlug(name) ||
		typeof displayName !== 'string' ||
		typeof description !== 'string' ||
		typeof version !== 'string' ||
		!VERSION.test(version) ||
		typeof publishedOn !== 'string' ||
		!DAY.test(publishedOn) ||
		!isRecord(pack) ||
		typeof pack['sha256'] !== 'string' ||
		!SHA256.test(pack['sha256']) ||
		typeof pack['size'] !== 'number'
	) {
		return null;
	}
	return {
		publisher,
		name,
		displayName,
		description,
		version,
		publishedOn,
		repository: typeof repository === 'string' ? repository : null,
		mcpServers: serversOf(value['mcpServers']),
		skills: readArray(Array.isArray(value['skills']) ? value['skills'] : []).filter(isSlug),
		package: { sha256: pack['sha256'], size: pack['size'] },
	};
}

function serversOf(value: unknown): ExtensionServer[] {
	if (!Array.isArray(value)) return [];
	return readArray(value).flatMap((server) =>
		isRecord(server) &&
		isSlug(server['name']) &&
		typeof server['url'] === 'string' &&
		server['url'].startsWith('https://')
			? [{ name: server['name'], url: server['url'] }]
			: [],
	);
}

function yankedOf(value: unknown): YankedVersion | null {
	if (!isRecord(value)) return null;
	const { publisher, name, version } = value;
	if (!isSlug(publisher) || !isSlug(name) || typeof version !== 'string') return null;
	return { publisher, name, version };
}

function versionOf(value: unknown): ExtensionVersion | null {
	if (!isRecord(value)) return null;
	const { version, publishedOn, yanked } = value;
	if (typeof version !== 'string' || typeof publishedOn !== 'string') return null;
	return { version, publishedOn, yanked: yanked === true };
}

function readArray(value: readonly unknown[]): readonly unknown[] {
	return value;
}

function isSlug(value: unknown): value is string {
	return typeof value === 'string' && value.length <= 64 && SLUG.test(value);
}

function reason(error: unknown): string {
	if (error instanceof Error && error.name === 'TimeoutError') return 'it did not answer in time';
	return error instanceof Error ? error.message : String(error);
}
