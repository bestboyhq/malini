import { windowControlsStore } from '$lib/app/infrastructure/stores/window-controls.store.svelte';

class WindowControlsQuery {
	public readonly focused: boolean = $derived(windowControlsStore.state.focused);
	public readonly maximized: boolean = $derived(windowControlsStore.state.maximized);
}

export const windowControlsQuery = new WindowControlsQuery();
