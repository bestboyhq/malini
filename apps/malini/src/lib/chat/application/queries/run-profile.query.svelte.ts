import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import type { AgentRunProfile } from '$shared/providers/providers.api';

export { runProfileQuery };

class RunProfileQuery {
	public readonly data: AgentRunProfile = $derived(
		chatModelStore.previewFor(chatRoute.requestedSessionId)?.profile ?? chatModelStore.profile,
	);
}

const runProfileQuery = new RunProfileQuery();
