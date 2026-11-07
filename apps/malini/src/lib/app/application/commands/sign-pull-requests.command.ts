import { signPullRequestsService } from '$lib/app/infrastructure/services/sign-pull-requests.service';
import { signPullRequestsStore } from '$lib/app/infrastructure/stores/sign-pull-requests.store.svelte';

export function signPullRequestsCommand(signed: boolean): void {
	const previous = signPullRequestsStore.signed;
	signPullRequestsStore.set(signed);
	void (async () => {
		try {
			await signPullRequestsService.write(signed);
		} catch (error) {
			signPullRequestsStore.set(previous);
			console.error('[malini app] could not save the sign pull requests setting', error);
		}
	})();
}
