import type { GitHubCliInstall } from '$shared/repositories/domain/github-auth';
import { githubCliInstallStore } from '$shared/repositories/infrastructure/stores/github-cli-install.store.svelte';

export { githubCliInstallQuery };

class GitHubCliInstallQuery {
	public readonly data: GitHubCliInstall = $derived(githubCliInstallStore.state);
}

const githubCliInstallQuery = new GitHubCliInstallQuery();
