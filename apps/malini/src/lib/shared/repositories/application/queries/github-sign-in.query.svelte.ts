import type { GitHubSignInState } from '$shared/repositories/domain/github-auth';
import { githubSignInStore } from '$shared/repositories/infrastructure/stores/github-sign-in.store.svelte';

export { githubSignInQuery };

class GitHubSignInQuery {
	public readonly data: GitHubSignInState = $derived(githubSignInStore.state);
}

const githubSignInQuery = new GitHubSignInQuery();
