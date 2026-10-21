import { workstreamsService } from '$shared/repositories/infrastructure/services/workstreams.service';
import { seedWorkstreamDependenciesCommand } from './seed-workstream-dependencies.command';

export { syncOwnPullRequestsCommand };

function syncOwnPullRequestsCommand(): void {
	void (async () => {
		for (const workstreamId of await workstreamsService.syncOwnPullRequests()) {
			seedWorkstreamDependenciesCommand(workstreamId);
		}
	})().catch(() => {});
}
