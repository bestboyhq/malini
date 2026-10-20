import { forgetWorkstreamChatsCommand } from '$lib/chat/application/commands/forget-workstream-chats.command';
import { workstreamRemovalsService } from '$lib/chat/infrastructure/services/workstream-removals.service';

export function forgetRemovedWorkstreamChatsHook(): () => void {
	return workstreamRemovalsService.onRemoved(forgetWorkstreamChatsCommand);
}
