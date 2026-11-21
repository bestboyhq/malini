import { checkoutFixTurnsStore } from '$lib/chat/infrastructure/stores/checkout-fix-turns.store.svelte';

export { checkoutFixTurnQuery };

class CheckoutFixTurnQuery {
	public readonly data: (workstreamId: string) => boolean = $derived((workstreamId: string) =>
		checkoutFixTurnsStore.has(workstreamId),
	);
}

const checkoutFixTurnQuery = new CheckoutFixTurnQuery();
