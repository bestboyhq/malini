import { seedWorkstreamDependenciesCommand } from '$shared/repositories/application/commands/seed-workstream-dependencies.command';
import { workstreamsService } from '$shared/repositories/infrastructure/services/workstreams.service';

const OWN_PULL_REQUESTS_POLL_MS = 5 * 60_000;

export function followOwnPullRequestsHook(): () => void {
	const sync = async (): Promise<void> => {
		for (const workstreamId of await workstreamsService.syncOwnPullRequests()) {
			seedWorkstreamDependenciesCommand(workstreamId);
		}
	};
	void sync().catch(() => {});
	const timer = setInterval(() => void sync().catch(() => {}), OWN_PULL_REQUESTS_POLL_MS);
	return () => clearInterval(timer);
}
