import { githubReachAggregate } from '$shared/repositories/infrastructure/aggregates/github-reach.aggregate.svelte';

export function watchGithubReachHook(): () => void {
	return githubReachAggregate.watch();
}
