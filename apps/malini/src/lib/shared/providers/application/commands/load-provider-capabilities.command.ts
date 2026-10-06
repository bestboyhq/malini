import { providerCapabilitiesStore } from '$shared/providers/infrastructure/stores/provider-capabilities.store.svelte';

export { loadProviderCapabilitiesCommand };

function loadProviderCapabilitiesCommand(mode: 'once' | 'stale' | 'force' = 'once'): void {
	if (mode === 'force') {
		void providerCapabilitiesStore.refresh();
		return;
	}
	if (mode === 'stale') {
		void providerCapabilitiesStore.refreshIfStale();
		return;
	}
	void providerCapabilitiesStore.loadOnce();
}
