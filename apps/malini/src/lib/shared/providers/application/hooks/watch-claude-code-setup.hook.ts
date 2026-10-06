import { providerCapabilitiesStore } from '$shared/providers/infrastructure/stores/provider-capabilities.store.svelte';

const SETUP_POLL_MS = 3_000;

export function watchClaudeCodeSetupHook(): () => void {
	const recheck = (): void => {
		if (providerCapabilitiesStore.capability?.state === 'ready') return;
		void providerCapabilitiesStore.refresh();
	};
	void providerCapabilitiesStore.loadOnce();
	const timer = setInterval(recheck, SETUP_POLL_MS);
	window.addEventListener('focus', recheck);
	return () => {
		clearInterval(timer);
		window.removeEventListener('focus', recheck);
	};
}
