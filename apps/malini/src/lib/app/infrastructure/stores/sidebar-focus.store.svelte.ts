import {
	DEFAULT_SIDEBAR_FOCUS,
	readSidebarFocus,
	type SidebarFocusState,
} from '$lib/app/domain/sidebar-focus';

const STORAGE_KEY = 'malini.app.sidebar-focus:v1';

class SidebarFocusStore {
	state: SidebarFocusState = $state(loadSidebarFocus());

	save(state: SidebarFocusState): void {
		this.state = state;
		try {
			globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
		} catch {}
	}
}

function loadSidebarFocus(): SidebarFocusState {
	try {
		return readSidebarFocus(JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null'));
	} catch {
		return DEFAULT_SIDEBAR_FOCUS;
	}
}

export const sidebarFocusStore = new SidebarFocusStore();
