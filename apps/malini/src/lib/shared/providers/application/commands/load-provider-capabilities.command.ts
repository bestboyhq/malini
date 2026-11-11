import { providerCapabilitiesStore } from '$shared/providers/infrastructure/stores/provider-capabilities.store.svelte';
import { updateClaudeCodeCommand } from '$shared/providers/application/commands/update-claude-code.command';

export { loadProviderCapabilitiesCommand };

function loadProviderCapabilitiesCommand(mode: 'once' | 'stale' = 'once'): void {
	if (mode === 'stale') {
		void providerCapabilitiesStore.refreshIfStale();
		updateClaudeCodeCommand();
		return;
	}
	void providerCapabilitiesStore.loadOnce();
}
