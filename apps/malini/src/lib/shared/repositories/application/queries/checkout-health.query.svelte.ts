import type { CheckoutHealth } from '$contract/repositories';
import { checkoutHealthAggregate } from '$shared/repositories/infrastructure/aggregates/checkout-health.aggregate.svelte';

export { checkoutHealthQuery };

class CheckoutHealthQuery {
	public readonly data: (workstreamId: string) => CheckoutHealth = $derived(
		(workstreamId: string) => checkoutHealthAggregate.healthOf(workstreamId),
	);
}

const checkoutHealthQuery = new CheckoutHealthQuery();
