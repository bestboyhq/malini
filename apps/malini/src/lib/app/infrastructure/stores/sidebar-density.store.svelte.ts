import { parseSidebarDensity, type SidebarDensity } from '$lib/app/domain/sidebar-density';

const STORAGE_KEY = 'malini.settings.sidebar-density';

class SidebarDensityStore {
	density: SidebarDensity = $state(loadSidebarDensity());

	choose(density: SidebarDensity): void {
		this.density = density;
		try {
			globalThis.localStorage?.setItem(STORAGE_KEY, density);
		} catch {}
	}
}

function loadSidebarDensity(): SidebarDensity {
	try {
		return parseSidebarDensity(globalThis.localStorage?.getItem(STORAGE_KEY) ?? null);
	} catch {
		return parseSidebarDensity(null);
	}
}

export const sidebarDensityStore = new SidebarDensityStore();
