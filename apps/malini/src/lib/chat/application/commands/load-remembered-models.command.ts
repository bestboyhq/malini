import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { loadModelDefaultsCommand } from '$shared/providers/providers.api';

export { loadRememberedModelsCommand };

function loadRememberedModelsCommand(): void {
	loadModelDefaultsCommand();
	chatModelStore.loadRememberedModels();
}
