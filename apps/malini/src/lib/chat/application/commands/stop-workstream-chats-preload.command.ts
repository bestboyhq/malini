import { workstreamChatsPreloader } from '$lib/chat/infrastructure/services/workstream-chats-preloader.service';

export { stopWorkstreamChatsPreloadCommand };

function stopWorkstreamChatsPreloadCommand(): void {
	workstreamChatsPreloader.stop();
}
