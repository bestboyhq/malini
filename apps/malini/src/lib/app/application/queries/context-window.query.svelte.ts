import { contextWindowStore } from '$lib/app/infrastructure/stores/context-window.store.svelte';

class ContextWindowQuery {
	public readonly data: number | null = $derived(contextWindowStore.tokens);
}

export const contextWindowQuery = new ContextWindowQuery();
