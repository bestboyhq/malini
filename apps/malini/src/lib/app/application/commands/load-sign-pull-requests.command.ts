import { signPullRequestsService } from '$lib/app/infrastructure/services/sign-pull-requests.service';
import { signPullRequestsStore } from '$lib/app/infrastructure/stores/sign-pull-requests.store.svelte';

export function loadSignPullRequestsCommand(): void {
	void (async () => {
		try {
			signPullRequestsStore.set(await signPullRequestsService.read());
		} catch (error) {
			signPullRequestsStore.set(null);
			console.error('[malini app] could not read the sign pull requests setting', error);
		}
	})();
}
