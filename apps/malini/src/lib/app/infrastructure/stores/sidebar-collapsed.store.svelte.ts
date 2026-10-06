import {
	defaultStorageKey,
	loadPanelSize,
	savePanelSize,
} from '$hyper-ui/components/resizable-split';

const STORAGE_KEY = defaultStorageKey('shell-sidebar-collapsed');

class SidebarCollapsedStore {
	#collapsed = $state(false);
	#hydrated = false;

	get current(): boolean {
		return this.#collapsed;
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
		this.#collapsed = !this.#collapsed;
		savePanelSize(STORAGE_KEY, this.#collapsed ? 1 : 0);
	}
}

export const sidebarCollapsedStore = new SidebarCollapsedStore();
