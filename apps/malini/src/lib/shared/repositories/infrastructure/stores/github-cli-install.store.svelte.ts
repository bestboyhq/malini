import type { GitHubCliInstall } from '$shared/repositories/domain/github-auth';

class GitHubCliInstallStore {
	state: GitHubCliInstall = $state.raw({ kind: 'idle' });
}

export const githubCliInstallStore = new GitHubCliInstallStore();
