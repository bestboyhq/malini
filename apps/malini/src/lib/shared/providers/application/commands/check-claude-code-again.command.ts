import { providerCapabilitiesStore } from '$shared/providers/infrastructure/stores/provider-capabilities.store.svelte';

export { checkClaudeCodeAgainCommand };

function checkClaudeCodeAgainCommand(): Promise<void> {
	return providerCapabilitiesStore.refresh();
}
