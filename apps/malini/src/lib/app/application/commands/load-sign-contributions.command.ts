import { signContributionsService } from '$lib/app/infrastructure/services/sign-contributions.service';
import { signContributionsStore } from '$lib/app/infrastructure/stores/sign-contributions.store.svelte';

export function loadSignContributionsCommand(): void {
	void (async () => {
		try {
			signContributionsStore.set(await signContributionsService.read());
		} catch (error) {
			signContributionsStore.set(null);
			console.error('[malini app] could not read the sign contributions setting', error);
		}
	})();
}
