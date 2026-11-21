import type { CheckoutHealth } from '$contract/repositories';
import { checkoutHealthAggregate } from '$shared/repositories/infrastructure/aggregates/checkout-health.aggregate.svelte';

export { loadCheckoutHealthCommand };

async function loadCheckoutHealthCommand(workstreamId: string): Promise<CheckoutHealth> {
	await checkoutHealthAggregate.load(workstreamId);
	return checkoutHealthAggregate.healthOf(workstreamId);
}
