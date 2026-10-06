import { workstreamEventsService } from '$shared/repositories/infrastructure/services/workstream-events.service';
import { refreshWorkstreamAfterChangeCommand } from '$shared/repositories/application/commands/refresh-workstream-after-change.command';

export function watchWorkstreamFilesChangedHook(): () => void {
	return workstreamEventsService.onFilesChanged(refreshWorkstreamAfterChangeCommand);
}
