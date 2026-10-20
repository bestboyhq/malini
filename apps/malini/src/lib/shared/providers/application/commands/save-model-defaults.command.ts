import type { ModelPreferences } from '$shared/providers/domain/model-preferences';
import { modelDefaultsStorage } from '$shared/providers/infrastructure/services/model-defaults.storage';
import { modelDefaultsStore } from '$shared/providers/infrastructure/stores/model-defaults.store.svelte';

export { saveModelDefaultsCommand };

function saveModelDefaultsCommand(preferences: ModelPreferences): void {
	modelDefaultsStore.set(modelDefaultsStorage.write(preferences));
}
