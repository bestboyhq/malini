import type { MaliniDatabase } from '$main/db/driver';
import { MODELS_DEV_URL, modelsDevModels } from '$shared/providers/domain/models-dev';
import { listStoredProviders, setProviderModels } from './provider.repository';

export type CatalogFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface ModelsDevDeps {
	readonly db: MaliniDatabase;
	readonly fetch: CatalogFetch;
	readonly url: string;
	readonly now?: () => number;
}

const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_CATALOG_BYTES = 32 * 1024 * 1024;

export function modelsDevUrl(
	packaged: boolean,
	env: Readonly<Record<string, string | undefined>>,
): string {
	const local = packaged ? undefined : env['MALINI_MODELS_DEV_URL'];
	return local || MODELS_DEV_URL;
}

export class ModelsDevCatalog {
	readonly #deps: ModelsDevDeps;
	readonly #now: () => number;
	#etag: string | null = null;
	#checkedAt = Number.NEGATIVE_INFINITY;
	#inflight: Promise<void> | null = null;

	constructor(deps: ModelsDevDeps) {
		this.#deps = deps;
		this.#now = deps.now ?? Date.now;
	}

	refresh(): Promise<void> {
		if (this.#inflight) return this.#inflight;
		if (this.#now() - this.#checkedAt < REFRESH_INTERVAL_MS) return Promise.resolve();
		const operation = this.#load()
			.catch(() => undefined)
			.finally(() => {
				this.#inflight = null;
			});
		this.#inflight = operation;
		return operation;
	}

	async #load(): Promise<void> {
		const response = await this.#deps.fetch(this.#deps.url, {
			headers: this.#etag ? { 'If-None-Match': this.#etag } : {},
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		if (response.status === 304) {
			this.#checkedAt = this.#now();
			return;
		}
		if (!response.ok) return;
		if (Number(response.headers.get('content-length') ?? '0') > MAX_CATALOG_BYTES) return;
		const body = await response.text();
		if (body.length > MAX_CATALOG_BYTES) return;
		const catalog: unknown = JSON.parse(body);
		for (const provider of listStoredProviders(this.#deps.db)) {
			if (provider.kind !== 'anthropic') continue;
			const models = modelsDevModels(catalog, provider.id);
			if (models.length > 0) setProviderModels(this.#deps.db, provider.id, models);
		}
		this.#etag = response.headers.get('etag');
		this.#checkedAt = this.#now();
	}
}
