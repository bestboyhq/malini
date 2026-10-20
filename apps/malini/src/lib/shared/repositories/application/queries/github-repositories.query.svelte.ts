import type { GithubRepositoryListing } from '$shared/repositories/domain/repository';
import { githubRepositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/github-repositories.aggregate.svelte';

export { githubRepositoriesQuery };

class GithubRepositoriesQuery {
	public readonly data: GithubRepositoryListing = $derived(githubRepositoriesAggregate.listing);
}

const githubRepositoriesQuery = new GithubRepositoriesQuery();
