import { githubRepositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/github-repositories.aggregate.svelte';

export { loadGithubOrganizationsCommand };

function loadGithubOrganizationsCommand(): void {
	void githubRepositoriesAggregate.loadOrganizations();
}
