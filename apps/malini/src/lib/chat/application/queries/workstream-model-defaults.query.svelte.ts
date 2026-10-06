import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import type { ModelPreferences } from '$shared/providers/providers.api';

export { workstreamModelDefaultsQuery };

class WorkstreamModelDefaultsQuery {
	public readonly data: ModelPreferences = $derived(chatModelStore.workstreamDefaults);
}

const workstreamModelDefaultsQuery = new WorkstreamModelDefaultsQuery();
