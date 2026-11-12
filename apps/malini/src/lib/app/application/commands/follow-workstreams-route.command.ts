import { registerAttentionScopeCommand } from '$lib/chat/application/commands/register-attention-scope.command';
import { loadPullRequestStatesCommand } from '$lib/pull-requests/application/commands/load-pull-request-states.command';
import {
	displayWorkstreamName,
	repositoryContextForWorkstream,
	trackWorkstreamChangeTotalsCommand,
	type Repository,
	type Workstream,
} from '$shared/repositories/repositories.api';

export { followWorkstreamsRouteCommand };

function followWorkstreamsRouteCommand(
	workstreams: readonly Workstream[],
	checkedOutWorkstreams: readonly Workstream[],
	repositories: readonly Repository[],
	loaded: boolean,
): void {
	trackWorkstreamChangeTotalsCommand(
		checkedOutWorkstreams.map(({ id, baseBranch }) => ({ id, baseBranch })),
	);
	loadPullRequestStatesCommand(
		checkedOutWorkstreams.map(({ id, projectId, branch, baseBranch }) => ({
			workstreamId: id,
			repoId: projectId,
			head: branch,
			base: baseBranch,
		})),
	);
	if (!loaded) return;
	registerAttentionScopeCommand(
		workstreams.map((workstream) => {
			const context = repositoryContextForWorkstream({
				repositories,
				workstreams,
				workstreamId: workstream.id,
			});
			return {
				workstreamId: workstream.id,
				label: displayWorkstreamName(workstream, context?.repo.fullName ?? ''),
				repositoryFullName: context?.repo.fullName ?? '',
				branch: workstream.branch,
			};
		}),
	);
}
