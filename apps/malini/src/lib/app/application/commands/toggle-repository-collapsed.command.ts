import { collapsedRepositoriesStore } from '$lib/app/infrastructure/stores/collapsed-repositories.store.svelte';

export function toggleRepositoryCollapsedCommand(repositoryId: string): void {
	collapsedRepositoriesStore.toggle(repositoryId);
}
