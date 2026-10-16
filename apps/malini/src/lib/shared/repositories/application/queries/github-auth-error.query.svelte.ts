import { githubAuthAggregate } from '$shared/repositories/infrastructure/aggregates/github-auth.aggregate.svelte';

export { githubAuthErrorQuery };

class GitHubAuthErrorQuery {
	public readonly data: string | null = $derived(githubAuthAggregate.error);
}

const githubAuthErrorQuery = new GitHubAuthErrorQuery();
