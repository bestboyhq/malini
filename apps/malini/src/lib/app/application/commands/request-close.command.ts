import { closeConfirmationStore } from '$lib/app/infrastructure/stores/close-confirmation.store.svelte';
import { windowLifecycleService } from '$lib/app/infrastructure/services/window-lifecycle.service';

export function requestCloseCommand(): void {
	if (closeConfirmationStore.closing) return;
	closeConfirmationStore.beginRequest();

	void (async () => {
		try {
			closeConfirmationStore.setImpact(await windowLifecycleService.readShutdownImpact());
		} catch (error) {
			closeConfirmationStore.failImpact();
			console.error('[malini lifecycle] could not read what a close would stop', error);
		}
	})();
}
