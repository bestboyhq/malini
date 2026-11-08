import { lidHoldStore } from '$lib/app/infrastructure/stores/lid-hold.store.svelte';

class LidHoldQuery {
	public readonly on: boolean | null = $derived(lidHoldStore.on);
	public readonly asking: boolean = $derived(lidHoldStore.asking);
	public readonly refused: boolean = $derived(lidHoldStore.refused);
}

export const lidHoldQuery = new LidHoldQuery();
