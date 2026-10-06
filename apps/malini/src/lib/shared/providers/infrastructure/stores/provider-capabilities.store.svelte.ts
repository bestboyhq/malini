import type { ProviderCapability } from '$contract/agent';
import { agentCapabilitiesService } from '$shared/providers/infrastructure/services/agent-capabilities.service';

type ProviderCapabilityLoadState = 'idle' | 'loading' | 'ready' | 'error';

export const PROVIDER_CAPABILITY_FRESHNESS_MS = 30_000;

export class ProviderCapabilitiesStore {
	capability = $state<ProviderCapability | null>(null);
	loadState = $state<ProviderCapabilityLoadState>('idle');
	error = $state<string | null>(null);
	lastVerifiedAt = $state<number | null>(null);

	readonly #load: (refresh: boolean) => Promise<ProviderCapability[]>;
	#inflight: Promise<void> | null = null;
	#hasProbed = false;

	constructor(
		load: (refresh: boolean) => Promise<ProviderCapability[]> = (refresh) =>
			agentCapabilitiesService.list(refresh),
	) {
		this.#load = load;
	}

	get cold(): boolean {
		return this.loadState === 'loading' && this.lastVerifiedAt === null;
	}

	loadOnce(): Promise<void> {
		if (this.#hasProbed) return this.#inflight ?? Promise.resolve();
		this.#hasProbed = true;
		return this.#loadCapabilities();
	}

	refresh(): Promise<void> {
		this.#hasProbed = true;
		return this.#loadCapabilities(true);
	}

	refreshIfStale(maxAgeMs = PROVIDER_CAPABILITY_FRESHNESS_MS, now = Date.now()): Promise<void> {
		if (!this.#hasProbed) return this.loadOnce();
		if (this.#inflight) return this.#inflight;
		const age = this.lastVerifiedAt === null ? Number.POSITIVE_INFINITY : now - this.lastVerifiedAt;
		if (this.loadState === 'error' || age >= maxAgeMs) {
			return this.#loadCapabilities(true);
		}
		return Promise.resolve();
	}

	#loadCapabilities(force = false): Promise<void> {
		if (this.#inflight) return this.#inflight;
		if (!force && this.loadState === 'ready') return Promise.resolve();

		this.loadState = 'loading';
		this.error = null;
		const operation = (async () => {
			try {
				const capabilities = await this.#load(force);
				this.capability = capabilities.at(-1) ?? null;
				this.lastVerifiedAt = Date.now();
				this.loadState = 'ready';
			} catch (error: unknown) {
				this.error = error instanceof Error ? error.message : String(error);
				this.loadState = 'error';
			} finally {
				this.#inflight = null;
			}
		})();
		this.#inflight = operation;
		return operation;
	}
}

export const providerCapabilitiesStore = new ProviderCapabilitiesStore();
