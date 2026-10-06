import { workstreamProvisioning } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { goto } from '$shared/router/navigation';
import { REPOSITORIES_HREF, workstreamHref } from '$shared/router/routes-hrefs';
import { abandonWorkstreamProvisioningCommand } from './abandon-workstream-provisioning.command';

export { removeFailedWorkstreamCommand };

function removeFailedWorkstreamCommand(workstreamId: string): void {
	const fallback = workstreamsAggregate.workstreams.find(
		(candidate) =>
			candidate.id !== workstreamId &&
			candidate.status !== 'archived' &&
			!workstreamProvisioning.hasPendingWorktree(candidate.id),
	);
	abandonWorkstreamProvisioningCommand(workstreamId);
	void goto(fallback ? workstreamHref(fallback.id) : REPOSITORIES_HREF);
}
