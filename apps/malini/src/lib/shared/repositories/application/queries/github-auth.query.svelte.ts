import type { GitHubAuthStatus } from '$shared/repositories/domain/github-auth';
import { githubAuthAggregate } from '$shared/repositories/infrastructure/aggregates/github-auth.aggregate.svelte';

export { githubAuthQuery };

class GitHubAuthQuery {
	public readonly data: GitHubAuthStatus | null = $derived(githubAuthAggregate.status);
}

const githubAuthQuery = new GitHubAuthQuery();
