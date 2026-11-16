import { githubRepositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/github-repositories.aggregate.svelte';

export { githubOrganizationsQuery };

class GithubOrganizationsQuery {
	public readonly data: readonly string[] = $derived(githubRepositoriesAggregate.organizations);
}

const githubOrganizationsQuery = new GithubOrganizationsQuery();
