import { readSidebarOrder, type SidebarOrder } from '$shared/repositories/domain/sidebar-order';

const STORAGE_KEY = 'malini.repositories.sidebar-order:v1';

class SidebarOrderStore {
	order: SidebarOrder = $state(loadSidebarOrder());

	set(order: SidebarOrder): void {
		this.order = order;
		try {
			globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(order));
		} catch {}
	}
}

function loadSidebarOrder(): SidebarOrder {
	try {
		return readSidebarOrder(JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null'));
	} catch {
		return readSidebarOrder(null);
	}
}

export const sidebarOrderStore = new SidebarOrderStore();
