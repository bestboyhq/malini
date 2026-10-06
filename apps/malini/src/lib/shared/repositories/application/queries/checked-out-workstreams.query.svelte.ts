import { workstreamNativeExistence } from '$shared/repositories/domain/provisioning';
import type { Workstream } from '$shared/repositories/domain/workstream';
import { workstreamProvisioning } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';

export { checkedOutWorkstreamsQuery };

class CheckedOutWorkstreamsQuery {
	public readonly data: readonly Workstream[] = $derived(
		workstreamsAggregate.workstreams.filter(
			(workstream) =>
				workstream.status !== 'archived' &&
				workstreamNativeExistence(workstreamProvisioning.get(workstream.id)) === 'platform',
		),
	);
}

const checkedOutWorkstreamsQuery = new CheckedOutWorkstreamsQuery();
