import { checkoutFindingCopy } from '$shared/repositories/domain/checkout-finding-copy';
import { setupRepositoryName } from '$shared/repositories/domain/workstream-setup-steps';
import { checkoutHealthAggregate } from '$shared/repositories/infrastructure/aggregates/checkout-health.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';

export { checkoutWaitQuery };

class CheckoutWaitQuery {
	public readonly data: (workstreamId: string) => string | null = $derived(
		(workstreamId: string) => {
			const health = checkoutHealthAggregate.healthOf(workstreamId);
			if (health.state === 'healthy') return null;
			const workstream = workstreamsAggregate.workstreams.find(({ id }) => id === workstreamId);
			const repository = setupRepositoryName(
				workstream?.projectId ?? '',
				workstreamsAggregate.projects,
			);
			return checkoutFindingCopy(health.finding ?? 'unknown', repository).waiting;
		},
	);
}

const checkoutWaitQuery = new CheckoutWaitQuery();
