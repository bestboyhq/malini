import { closeConfirmationStore } from '$lib/app/infrastructure/stores/close-confirmation.store.svelte';

export function cancelCloseCommand(): void {
	if (closeConfirmationStore.closing) return;
	closeConfirmationStore.dismiss();
}
