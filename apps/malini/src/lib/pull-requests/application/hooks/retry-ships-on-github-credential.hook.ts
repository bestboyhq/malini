import { listenGithubCredentialStored } from '$shared/auth/auth-session-events';
import { retryShipsWaitingOnGithubCommand } from '$lib/pull-requests/application/commands/retry-ships-waiting-on-github.command';

export function retryShipsOnGithubCredentialHook(): () => void {
	return listenGithubCredentialStored(retryShipsWaitingOnGithubCommand);
}
