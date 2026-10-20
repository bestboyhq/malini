import { githubAuthAggregate } from '$shared/repositories/infrastructure/aggregates/github-auth.aggregate.svelte';

export function watchGithubAuthHook(): () => void {
	const recheck = (): void => {
		if (githubAuthAggregate.status?.authenticated) return;
		void githubAuthAggregate.load();
	};
	void githubAuthAggregate.load();
	window.addEventListener('focus', recheck);
	return () => window.removeEventListener('focus', recheck);
}
