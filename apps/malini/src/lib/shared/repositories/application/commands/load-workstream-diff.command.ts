import { workstreamDiffAggregate } from '$shared/repositories/infrastructure/aggregates/workstream-diff.aggregate.svelte';

export { loadWorkstreamDiffCommand };

function loadWorkstreamDiffCommand(workstreamId: string, path: string | null): void {
	void workstreamDiffAggregate.load(workstreamId, path);
}
