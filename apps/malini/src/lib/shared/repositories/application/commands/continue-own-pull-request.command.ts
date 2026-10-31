import { toast } from '$hyper-ui/components/toast';
import type { OwnPullRequest } from '$shared/repositories/domain/own-pull-requests';
import { workstreamActionFailureMessage } from '$shared/repositories/domain/workstream-action';
import { ownPullRequestsAggregate } from '$shared/repositories/infrastructure/aggregates/own-pull-requests.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { workstreamsService } from '$shared/repositories/infrastructure/services/workstreams.service';
import { goto } from '$shared/router/navigation';
import { workstreamHref } from '$shared/router/routes-hrefs';
import { loadOwnPullRequestsCommand } from './load-own-pull-requests.command';
import { seedWorkstreamDependenciesCommand } from './seed-workstream-dependencies.command';

export { continueOwnPullRequestCommand };

function continueOwnPullRequestCommand(repoId: string, pullRequest: OwnPullRequest): void {
	if (ownPullRequestsAggregate.continuing.has(pullRequest.head)) return;
	ownPullRequestsAggregate.setContinuing(pullRequest.head, true);
	void (async () => {
		try {
			const workstreamId = await workstreamsService.continueOwnPullRequest(
				repoId,
				pullRequest.head,
			);
			await workstreamsAggregate.refresh();
			await goto(workstreamHref(workstreamId));
			if (pullRequest.workstream !== 'active') seedWorkstreamDependenciesCommand(workstreamId);
			loadOwnPullRequestsCommand(repoId);
		} catch (cause) {
			toast.error(
				`Couldn't continue #${pullRequest.number} here. ${workstreamActionFailureMessage(cause, 'Its branch could not be checked out')}`,
			);
		} finally {
			ownPullRequestsAggregate.setContinuing(pullRequest.head, false);
		}
	})();
}
