import { openNotifiedChatCommand } from '$lib/chat/application/commands/open-notified-chat.command';
import { notificationService } from '$shared/system/notification.service';

export function openNotifiedChatsHook(
	workstreamExists: (workstreamId: string) => boolean,
): () => void {
	return notificationService.onOpen((target) => openNotifiedChatCommand(target, workstreamExists));
}
