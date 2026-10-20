import { chatBootstrap } from '$lib/chat/infrastructure/services/chat-bootstrap.service';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export { bootChatCommand };

function bootChatCommand(workstreamId: string): void {
	chatSessionStore.bootstrappedFor = workstreamId;
	chatSessionStore.bootingWorkstreamId = workstreamId;
	void chatBootstrap.run(workstreamId, chatSessionStore.nextBootstrapSeq());
}
