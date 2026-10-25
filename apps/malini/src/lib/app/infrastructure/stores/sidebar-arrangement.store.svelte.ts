import {
	DEFAULT_SIDEBAR_ARRANGEMENT,
	readSidebarArrangement,
	type SidebarArrangement,
} from '$lib/app/domain/sidebar-arrangement';

const STORAGE_KEY = 'malini.app.sidebar-arrangement:v1';

class SidebarArrangementStore {
	arrangement: SidebarArrangement = $state(loadSidebarArrangement());

	save(arrangement: SidebarArrangement): void {
		this.arrangement = arrangement;
		try {
			globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(arrangement));
		} catch {}
	}
}

function loadSidebarArrangement(): SidebarArrangement {
	try {
		return readSidebarArrangement(
			JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null'),
		);
	} catch {
		return DEFAULT_SIDEBAR_ARRANGEMENT;
	}
}

export const sidebarArrangementStore = new SidebarArrangementStore();
