import type { SidebarOrder } from '$shared/repositories/domain/sidebar-order';
import { sidebarOrderStore } from '$shared/repositories/infrastructure/stores/sidebar-order.store.svelte';

export { sidebarOrderQuery };

class SidebarOrderQuery {
	public readonly data: SidebarOrder = $derived(sidebarOrderStore.order);
}

const sidebarOrderQuery = new SidebarOrderQuery();
