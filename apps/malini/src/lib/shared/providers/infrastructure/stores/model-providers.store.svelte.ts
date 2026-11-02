import type { ModelProviderRecord } from '$contract/agent';
import { modelProvidersService } from '$shared/providers/infrastructure/services/model-providers.service';

export class ModelProvidersStore {
	providers = $state<ModelProviderRecord[]>([]);
	#loaded = false;
	#inflight: Promise<void> | null = null;

	loadOnce(): Promise<void> {
		if (this.#loaded) return this.#inflight ?? Promise.resolve();
		return this.refresh();
	}

	async refresh(): Promise<void> {
		if (this.#inflight) return this.#inflight;
		const operation = this.#reload();
		this.#inflight = operation;
		try {
			await operation;
		} finally {
			if (this.#inflight === operation) this.#inflight = null;
		}
	}

	async #reload(): Promise<void> {
		this.providers = await modelProvidersService.list();
		this.#loaded = true;
	}

	replace(provider: ModelProviderRecord): void {
		this.providers = this.providers.map((candidate) =>
			candidate.id === provider.id ? provider : candidate,
		);
	}
}

export const modelProvidersStore = new ModelProvidersStore();
