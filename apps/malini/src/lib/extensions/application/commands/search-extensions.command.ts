import { marketplaceSearchStore } from '$lib/extensions/infrastructure/stores/marketplace-search.store.svelte';

export { searchExtensionsCommand };

function searchExtensionsCommand(query: string): void {
	marketplaceSearchStore.set(query);
}
