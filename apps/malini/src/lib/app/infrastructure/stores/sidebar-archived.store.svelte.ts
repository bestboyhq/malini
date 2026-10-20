import {
	clampSize,
	defaultStorageKey,
	loadPanelSize,
	savePanelSize,
} from '$hyper-ui/components/resizable-split';
import { ARCHIVED_HEIGHT } from '$lib/app/domain/sidebar-archived';

const STORAGE_KEY = defaultStorageKey('sidebar-recently-archived');

class SidebarArchivedStore {
	height = $state(
		loadPanelSize(STORAGE_KEY, ARCHIVED_HEIGHT.initial, ARCHIVED_HEIGHT.min, ARCHIVED_HEIGHT.max),
	);

	resize(height: number): void {
		this.height = clampSize(height, ARCHIVED_HEIGHT.min, ARCHIVED_HEIGHT.max);
		savePanelSize(STORAGE_KEY, this.height);
	}
}

export const sidebarArchivedStore = new SidebarArchivedStore();
