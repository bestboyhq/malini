import { checkoutHealthAggregate } from '$shared/repositories/infrastructure/aggregates/checkout-health.aggregate.svelte';
import { repairCheckoutCommand } from './repair-checkout.command';

export { repairCheckoutsAfterSignInCommand };

function repairCheckoutsAfterSignInCommand(): void {
	for (const [workstreamId, health] of Object.entries(checkoutHealthAggregate.byWorkstream)) {
		if (health.finding === 'github-signed-out' || health.finding === 'remote-missing') {
			repairCheckoutCommand(workstreamId);
		}
	}
}
