import type { ModelPreferences } from '$shared/providers/domain/model-preferences';
import { modelDefaultsStore } from '$shared/providers/infrastructure/stores/model-defaults.store.svelte';

export { modelDefaultsQuery };

class ModelDefaultsQuery {
	public readonly data: ModelPreferences = $derived(modelDefaultsStore.preferences);
}

const modelDefaultsQuery = new ModelDefaultsQuery();
