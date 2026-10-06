import {
	clampSize,
	defaultStorageKey,
	loadPanelSize,
	savePanelSize,
} from '$hyper-ui/components/resizable-split';
import {
	SIDEBAR_DEFAULT_WIDTH,
	SIDEBAR_MAX_WIDTH,
	SIDEBAR_MIN_WIDTH,
} from '$lib/app/domain/sidebar-width';

const STORAGE_KEY = defaultStorageKey('shell-sidebar');

class SidebarWidthStore {
	#width = $state(SIDEBAR_DEFAULT_WIDTH);
	#hydrated = false;

	get current(): number {
		return this.#width;
	}

	get storageKey(): string {
		return STORAGE_KEY;
	}

	hydrate(): void {
		if (this.#hydrated) return;
		this.#hydrated = true;
		this.#width = loadPanelSize(
			STORAGE_KEY,
			SIDEBAR_DEFAULT_WIDTH,
			SIDEBAR_MIN_WIDTH,
			SIDEBAR_MAX_WIDTH,
		);
	}

	set(next: number): void {
		this.#width = clampSize(next, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
	}

	reset(): void {
		this.set(SIDEBAR_DEFAULT_WIDTH);
		this.persist();
	}

	persist(): void {
		savePanelSize(STORAGE_KEY, this.#width);
	}
}

export const sidebarWidthStore = new SidebarWidthStore();
