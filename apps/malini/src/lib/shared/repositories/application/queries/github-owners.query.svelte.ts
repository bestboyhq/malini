import { githubRepositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/github-repositories.aggregate.svelte';

export { githubOwnersQuery };

class GithubOwnersQuery {
	public readonly data: readonly string[] = $derived(githubRepositoriesAggregate.owners);
}

const githubOwnersQuery = new GithubOwnersQuery();
