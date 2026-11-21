import { untrack } from 'svelte';
import { chatOccupancy } from '$lib/chat/infrastructure/services/chat-occupancy.service';
import { checkoutFixTurnsStore } from '$lib/chat/infrastructure/stores/checkout-fix-turns.store.svelte';
import { repairCheckoutCommand } from '$shared/repositories/repositories.api';

export function followCheckoutFixTurnsHook(): () => void {
	return $effect.root(() => {
		$effect(() => {
			const ended = Object.entries(checkoutFixTurnsStore.byWorkstream).filter(
				([, sessionId]) => sessionId !== null && !chatOccupancy.sessionIsBusy(sessionId),
			);
			untrack(() => {
				for (const [workstreamId] of ended) {
					repairCheckoutCommand(workstreamId);
					checkoutFixTurnsStore.end(workstreamId);
				}
			});
		});
	});
}
