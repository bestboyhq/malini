import { registerAttentionScopeCommand } from '$lib/chat/application/commands/register-attention-scope.command';
import { loadPullRequestStatesCommand } from '$lib/pull-requests/application/commands/load-pull-request-states.command';
import {
	displayWorkstreamName,
	repositoryContextForWorkstream,
	trackWorkstreamChangeTotalsCommand,
	workstreamLeads,
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
	const repositoryWork = checkedOutWorkstreams.filter((workstream) => workstream.scope === null);
	trackWorkstreamChangeTotalsCommand(
		repositoryWork.map(({ id, baseBranch }) => ({ id, baseBranch })),
	);
	loadPullRequestStatesCommand(
		repositoryWork.map(({ id, projectId, branch, baseBranch }) => ({
			workstreamId: id,
			repoId: projectId,
			head: branch,
			base: baseBranch,
		})),
	);
	if (!loaded) return;
	const contexts = workstreams.map((workstream) => {
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
	});
	const labels = new Map(contexts.map(({ workstreamId, label }) => [workstreamId, label]));
	const leads = workstreamLeads(workstreams);
	registerAttentionScopeCommand(
		contexts.map((context) => {
			const leadId = leads.get(context.workstreamId) ?? context.workstreamId;
			return {
				...context,
				lead:
					leadId === context.workstreamId
						? null
						: { workstreamId: leadId, label: labels.get(leadId) ?? '' },
			};
		}),
	);
}
