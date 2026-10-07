import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import type { ModelPreferences } from '$shared/providers/providers.api';

export { rememberedModelsQuery };

class RememberedModelsQuery {
	public readonly data: ModelPreferences = $derived(chatModelStore.rememberedModels);
}

const rememberedModelsQuery = new RememberedModelsQuery();
