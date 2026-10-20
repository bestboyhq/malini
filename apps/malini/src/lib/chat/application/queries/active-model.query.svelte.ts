import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { defaultAgentModel, type AgentModel } from '$shared/providers/providers.api';

export { activeModelQuery };

class ActiveModelQuery {
	public readonly data: AgentModel = $derived(
		chatModelStore.previewFor(chatRoute.requestedSessionId)?.model ??
			chatModelStore.model ??
			defaultAgentModel(),
	);
}

const activeModelQuery = new ActiveModelQuery();
