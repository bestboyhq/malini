import { consumeWorkstreamCreation } from '$shared/repositories/infrastructure/services/workstream-creation-marker.storage';

export { consumeWorkstreamCreationCommand };

function consumeWorkstreamCreationCommand(workstreamId: string): void {
	consumeWorkstreamCreation(workstreamId);
}
