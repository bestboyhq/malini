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

	refresh(): Promise<void> {
		if (this.#inflight) return this.#inflight;
		const operation = modelProvidersService
			.list()
			.then((providers) => {
				this.providers = providers;
				this.#loaded = true;
			})
			.finally(() => {
				if (this.#inflight === operation) this.#inflight = null;
			});
		this.#inflight = operation;
		return operation;
	}

	replace(provider: ModelProviderRecord): void {
		this.providers = this.providers.map((candidate) =>
			candidate.id === provider.id ? provider : candidate,
		);
	}
}

export const modelProvidersStore = new ModelProvidersStore();
