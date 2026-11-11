import { claudeSetupService } from '$shared/providers/infrastructure/services/claude-setup.service';
import { providerCapabilitiesStore } from '$shared/providers/infrastructure/stores/provider-capabilities.store.svelte';

export { loadProviderCapabilitiesCommand };

function loadProviderCapabilitiesCommand(mode: 'once' | 'stale' = 'once'): void {
	if (mode === 'stale') {
		void providerCapabilitiesStore.refreshIfStale();
		void (async () => {
			if (await claudeSetupService.update()) await providerCapabilitiesStore.reload();
		})();
		return;
	}
	void providerCapabilitiesStore.loadOnce();
}
