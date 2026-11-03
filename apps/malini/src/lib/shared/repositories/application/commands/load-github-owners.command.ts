import { githubRepositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/github-repositories.aggregate.svelte';

export { loadGithubOwnersCommand };

function loadGithubOwnersCommand(): void {
	void githubRepositoriesAggregate.loadOwners();
}
