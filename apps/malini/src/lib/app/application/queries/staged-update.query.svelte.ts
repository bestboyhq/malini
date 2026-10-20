import { stagedUpdateStore } from '$lib/app/infrastructure/stores/staged-update.store.svelte';

class StagedUpdateQuery {
	public readonly version: string | null = $derived(stagedUpdateStore.version);
	public readonly restarting: boolean = $derived(stagedUpdateStore.restarting);
}

export const stagedUpdateQuery = new StagedUpdateQuery();
