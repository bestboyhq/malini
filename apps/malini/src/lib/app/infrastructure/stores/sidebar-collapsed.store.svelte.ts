import {
	defaultStorageKey,
	loadPanelSize,
	savePanelSize,
} from '$hyper-ui/components/resizable-split';
import { isNarrowLayout } from '$shared/shell/narrow-layout.svelte';

const STORAGE_KEY = defaultStorageKey('shell-sidebar-collapsed');

class SidebarCollapsedStore {
	#collapsed = $state(false);
	#overlayOpen = $state(false);
	#hydrated = false;

	get current(): boolean {
		return this.#collapsed || isNarrowLayout();
	}

	get overlayOpen(): boolean {
		return this.#overlayOpen && isNarrowLayout();
	}

	get storageKey(): string {
		return STORAGE_KEY;
	}

	hydrate(): void {
		if (this.#hydrated) return;
		this.#hydrated = true;
		this.#collapsed = loadPanelSize(STORAGE_KEY, 0, 0, 1) === 1;
	}

	toggle(): void {
		if (isNarrowLayout()) {
			this.#overlayOpen = !this.#overlayOpen;
			return;
		}
		this.#collapsed = !this.#collapsed;
		savePanelSize(STORAGE_KEY, this.#collapsed ? 1 : 0);
	}

	closeOverlay(): void {
		this.#overlayOpen = false;
	}
}

export const sidebarCollapsedStore = new SidebarCollapsedStore();
