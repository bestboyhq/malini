import { listenGithubCredentialStored } from '$shared/auth/auth-session-events';
import { loadGithubRepositoriesCommand } from '$shared/repositories/application/commands/load-github-repositories.command';

export function reloadGithubRepositoriesOnSignInHook(): () => void {
	return listenGithubCredentialStored(loadGithubRepositoriesCommand);
}
