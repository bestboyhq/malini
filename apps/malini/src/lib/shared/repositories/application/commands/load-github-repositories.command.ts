import { githubRepositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/github-repositories.aggregate.svelte';

export { loadGithubRepositoriesCommand };

function loadGithubRepositoriesCommand(): void {
	void githubRepositoriesAggregate.load();
}
