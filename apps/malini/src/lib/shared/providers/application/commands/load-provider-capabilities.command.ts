import { providerCapabilitiesStore } from '$shared/providers/infrastructure/stores/provider-capabilities.store.svelte';

export { loadProviderCapabilitiesCommand };

function loadProviderCapabilitiesCommand(mode: 'once' | 'stale' = 'once'): void {
	if (mode === 'stale') {
		void providerCapabilitiesStore.refreshIfStale();
		return;
	}
	void providerCapabilitiesStore.loadOnce();
}
