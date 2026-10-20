import { closeConfirmationOf, type CloseConfirmation } from '$lib/app/domain/close-confirmation';
import { shutdownImpactLines } from '$lib/app/domain/shutdown-impact';
import { closeConfirmationStore } from '$lib/app/infrastructure/stores/close-confirmation.store.svelte';

class CloseConfirmationQuery {
	public readonly data: CloseConfirmation = $derived(
		closeConfirmationOf(
			closeConfirmationStore.open,
			closeConfirmationStore.impact === null
				? null
				: shutdownImpactLines(closeConfirmationStore.impact),
			closeConfirmationStore.impactFailed,
			closeConfirmationStore.closing,
			closeConfirmationStore.destroyFailed,
			closeConfirmationStore.outcome,
		),
	);
}

export const closeConfirmationQuery = new CloseConfirmationQuery();
