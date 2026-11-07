import { signContributionsService } from '$lib/app/infrastructure/services/sign-contributions.service';
import { signContributionsStore } from '$lib/app/infrastructure/stores/sign-contributions.store.svelte';

export function signContributionsCommand(signed: boolean): void {
	const previous = signContributionsStore.signed;
	signContributionsStore.set(signed);
	void (async () => {
		try {
			await signContributionsService.write(signed);
		} catch (error) {
			signContributionsStore.set(previous);
			console.error('[malini app] could not save the sign contributions setting', error);
		}
	})();
}
