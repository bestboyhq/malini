import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import {
	DEFAULT_PROVIDER_ID,
	defaultAgentModel,
	type ModelSelection,
} from '$shared/providers/providers.api';

export { activeModelQuery };

class ActiveModelQuery {
	public readonly data: ModelSelection = $derived(
		chatModelStore.previewFor(chatRoute.requestedSessionId)?.selection ??
			chatModelStore.selection ?? { provider: DEFAULT_PROVIDER_ID, model: defaultAgentModel() },
	);
}

const activeModelQuery = new ActiveModelQuery();
