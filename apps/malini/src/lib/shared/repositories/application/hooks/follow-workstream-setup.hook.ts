import { announceCreatedWorkstreamCommand } from '$shared/repositories/application/commands/announce-created-workstream.command';
import type { WorkstreamSetupOutcome } from '$shared/repositories/domain/provisioning';
import { workstreamEventsService } from '$shared/repositories/infrastructure/services/workstream-events.service';
import { workstreamSetupEvents } from '$shared/repositories/infrastructure/services/workstream-setup-events.service';

export function followWorkstreamSetupHook(
	listener: (outcome: WorkstreamSetupOutcome) => void,
): () => void {
	const stopSettled = workstreamSetupEvents.onSettled(listener);
	const stopCreated = workstreamEventsService.onWorkstreamCreated(announceCreatedWorkstreamCommand);
	return () => {
		stopSettled();
		stopCreated();
	};
}
