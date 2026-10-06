import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { modelLabel } from '$shared/providers/providers.api';

export { implementationModelLabelQuery };

class ImplementationModelLabelQuery {
	public readonly data: string = $derived(
		modelLabel(chatModelStore.workstreamPreferences.implementation.model),
	);
}

const implementationModelLabelQuery = new ImplementationModelLabelQuery();
