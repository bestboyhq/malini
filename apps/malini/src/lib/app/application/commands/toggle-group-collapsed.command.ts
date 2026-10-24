import { collapsedGroupsStore } from '$lib/app/infrastructure/stores/collapsed-groups.store.svelte';

export function toggleGroupCollapsedCommand(groupId: string): void {
	collapsedGroupsStore.toggle(groupId);
}
