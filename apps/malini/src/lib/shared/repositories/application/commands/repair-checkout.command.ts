import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { workstreamActionFailureMessage } from '$shared/repositories/domain/workstream-action';
import { checkoutHealthAggregate } from '$shared/repositories/infrastructure/aggregates/checkout-health.aggregate.svelte';

export { repairCheckoutCommand };

function repairCheckoutCommand(workstreamId: string): void {
	if (checkoutHealthAggregate.healthOf(workstreamId).state !== 'broken') return;
	void (async () => {
		try {
			await checkoutHealthAggregate.repair(workstreamId);
		} catch (cause) {
			toast.error(
				`Repair failed · ${workstreamActionFailureMessage(cause, 'the checkout is still broken')}`,
				aboutWorkstream(workstreamId),
			);
		}
	})();
}
