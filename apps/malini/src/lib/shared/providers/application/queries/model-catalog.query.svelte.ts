import type { AgentModelInfo } from '$contract/agent';
import { fallbackModelCatalog } from '$shared/providers/domain/model-catalog';
import { providerCapabilitiesStore } from '$shared/providers/infrastructure/stores/provider-capabilities.store.svelte';

export { modelCatalogQuery };

class ModelCatalogQuery {
	public readonly data: readonly AgentModelInfo[] = $derived(
		providerCapabilitiesStore.capability?.models ?? fallbackModelCatalog(),
	);
}

const modelCatalogQuery = new ModelCatalogQuery();
