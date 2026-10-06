import { forgetWorkstreamSurfaceCommand } from '$lib/pull-requests/application/commands/forget-workstream-surface.command';
import { workstreamRemovalsService } from '$lib/pull-requests/infrastructure/services/workstream-removals.service';

export function forgetRemovedWorkstreamSurfacesHook(): () => void {
	return workstreamRemovalsService.onRemoved(forgetWorkstreamSurfaceCommand);
}
