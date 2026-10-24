import { collapsedGroupsStore } from '$lib/app/infrastructure/stores/collapsed-groups.store.svelte';

class CollapsedGroupsQuery {
	public readonly data: ReadonlySet<string> = $derived(collapsedGroupsStore.ids);
}

export const collapsedGroupsQuery = new CollapsedGroupsQuery();
