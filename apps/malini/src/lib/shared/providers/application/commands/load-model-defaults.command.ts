import { modelDefaultsStorage } from '$shared/providers/infrastructure/services/model-defaults.storage';
import { modelDefaultsStore } from '$shared/providers/infrastructure/stores/model-defaults.store.svelte';

export { loadModelDefaultsCommand };

function loadModelDefaultsCommand(): void {
	modelDefaultsStore.set(modelDefaultsStorage.read());
}
