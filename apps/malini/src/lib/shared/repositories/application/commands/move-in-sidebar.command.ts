import { movedInSidebarOrder, type SidebarMove } from '$shared/repositories/domain/sidebar-order';
import { sidebarOrderStore } from '$shared/repositories/infrastructure/stores/sidebar-order.store.svelte';

export { moveInSidebarCommand };

function moveInSidebarCommand(move: SidebarMove): void {
	const listed = movedInSidebarOrder(move.listedIds, move.movedId, move.targetId, move.placement);
	const { order } = sidebarOrderStore;
	sidebarOrderStore.set(
		move.kind === 'repository'
			? { ...order, repositoryIds: listed }
			: { ...order, workstreamIds: listed },
	);
}
