import { workstreamGitStatusAggregate } from '$shared/repositories/infrastructure/aggregates/workstream-git-status.aggregate.svelte';

export { loadWorkstreamGitStatusCommand };

function loadWorkstreamGitStatusCommand(workstreamId: string): void {
	void workstreamGitStatusAggregate.load(workstreamId);
}
