import type { GitHubSignInState } from '$shared/repositories/domain/github-auth';

class GitHubSignInStore {
	state: GitHubSignInState = $state.raw({ kind: 'idle' });
	attempt = 0;
}

export const githubSignInStore = new GitHubSignInStore();
