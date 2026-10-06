import { closeConfirmationStore } from '$lib/app/infrastructure/stores/close-confirmation.store.svelte';
import { windowLifecycleService } from '$lib/app/infrastructure/services/window-lifecycle.service';

export function confirmCloseCommand(): void {
	if (closeConfirmationStore.closing) return;
	closeConfirmationStore.beginClosing();

	void (async () => {
		try {
			closeConfirmationStore.setOutcome(await windowLifecycleService.confirmShutdownAndClose());
		} catch (error) {
			closeConfirmationStore.failClosing();
			console.error('[malini lifecycle] the window refused to close', error);
		}
	})();
}
