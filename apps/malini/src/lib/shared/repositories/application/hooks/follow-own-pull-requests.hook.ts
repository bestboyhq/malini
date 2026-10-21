import { syncOwnPullRequestsCommand } from '$shared/repositories/application/commands/sync-own-pull-requests.command';

const OWN_PULL_REQUESTS_POLL_MS = 5 * 60_000;

export function followOwnPullRequestsHook(): () => void {
	syncOwnPullRequestsCommand();
	const timer = setInterval(syncOwnPullRequestsCommand, OWN_PULL_REQUESTS_POLL_MS);
	return () => clearInterval(timer);
}
