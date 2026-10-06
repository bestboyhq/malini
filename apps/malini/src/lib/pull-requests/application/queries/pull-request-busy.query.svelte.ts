import { pullRequestActionStore } from '$lib/pull-requests/infrastructure/stores/pull-request-action.store.svelte';

export { pullRequestBusyQuery };

class PullRequestBusyQuery {
	public readonly data: boolean = $derived(pullRequestActionStore.busy);
	public readonly label: string | null = $derived(pullRequestActionStore.busyLabel);
}

const pullRequestBusyQuery = new PullRequestBusyQuery();
