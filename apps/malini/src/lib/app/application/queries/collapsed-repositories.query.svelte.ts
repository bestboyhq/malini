import { collapsedRepositoriesStore } from '$lib/app/infrastructure/stores/collapsed-repositories.store.svelte';

class CollapsedRepositoriesQuery {
	public readonly data: ReadonlySet<string> = $derived(collapsedRepositoriesStore.ids);
}

export const collapsedRepositoriesQuery = new CollapsedRepositoriesQuery();
