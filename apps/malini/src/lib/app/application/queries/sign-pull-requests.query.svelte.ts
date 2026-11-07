import { signPullRequestsStore } from '$lib/app/infrastructure/stores/sign-pull-requests.store.svelte';

class SignPullRequestsQuery {
	public readonly signed: boolean | null = $derived(signPullRequestsStore.signed);
}

export const signPullRequestsQuery = new SignPullRequestsQuery();
