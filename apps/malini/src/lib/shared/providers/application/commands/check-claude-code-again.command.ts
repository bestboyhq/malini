import { providerCapabilitiesStore } from '$shared/providers/infrastructure/stores/provider-capabilities.store.svelte';

export { checkClaudeCodeAgainCommand };

function checkClaudeCodeAgainCommand(): void {
	providerCapabilitiesStore.checkingAgain = true;
	void providerCapabilitiesStore.refresh().finally(() => {
		providerCapabilitiesStore.checkingAgain = false;
	});
}
