import { githubAuthAggregate } from '$shared/repositories/infrastructure/aggregates/github-auth.aggregate.svelte';

export { loadGithubAuthCommand };

function loadGithubAuthCommand(): void {
	void githubAuthAggregate.load();
}
