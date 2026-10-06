import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import type { ModelPreferences } from '$shared/providers/providers.api';

export { workstreamModelPreferencesQuery };

class WorkstreamModelPreferencesQuery {
	public readonly data: ModelPreferences = $derived(chatModelStore.workstreamPreferences);
}

const workstreamModelPreferencesQuery = new WorkstreamModelPreferencesQuery();
