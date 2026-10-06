import { workstreamRetirementStore } from '$shared/repositories/infrastructure/stores/workstream-retirement.store.svelte';

export { undoWorkstreamRetirementCommand };

function undoWorkstreamRetirementCommand(workstreamId: string): void {
	workstreamRetirementStore.undo(workstreamId);
}
