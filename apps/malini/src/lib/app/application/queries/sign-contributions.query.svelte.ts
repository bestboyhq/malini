import { signContributionsStore } from '$lib/app/infrastructure/stores/sign-contributions.store.svelte';

class SignContributionsQuery {
	public readonly signed: boolean | null = $derived(signContributionsStore.signed);
}

export const signContributionsQuery = new SignContributionsQuery();
