import type { ModelPreset } from '$shared/providers/domain/model-preferences';
import { modelPresetsStore } from '$shared/providers/infrastructure/stores/model-presets.store.svelte';

export { modelPresetsQuery };

class ModelPresetsQuery {
	public readonly data: readonly ModelPreset[] = $derived(modelPresetsStore.presets);
}

const modelPresetsQuery = new ModelPresetsQuery();
