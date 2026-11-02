import { captureCheckpointEditTarget } from '$lib/chat/domain/checkpoint-edit-target';
import type { UndoRunRequest } from '$lib/chat/domain/checkpoint-requests';
import { errorMessage } from '$lib/chat/domain/error-message';
import { checkpoints } from '$lib/chat/infrastructure/services/checkpoint.service';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatRequestsStore } from '$lib/chat/infrastructure/stores/chat-requests.store.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export { undoRunCommand };

function undoRunCommand(request: UndoRunRequest): void {
	chatRequestsStore.begin(request.requestId);
	const target = captureCheckpointEditTarget({
		workstreamId: chatRoute.workstreamId,
		sessionId: chatSessionStore.sessionId,
		provider: chatModelStore.currentSelection().provider,
		model: chatModelStore.currentSelection().model,
		profile: chatModelStore.profile,
	});
	const selectionGeneration = chatSessionStore.selectionGeneration;
	void (async () => {
		try {
			if (!target) throw new Error('Agent session is not ready');
			const restored = await checkpoints.rewind(request.checkpointId, target, selectionGeneration);
			if (!restored) throw new Error('Chat changed while undoing, try again');
			chatRequestsStore.accept(request.requestId);
		} catch (error) {
			chatRequestsStore.fail(request.requestId, errorMessage(error, 'Undo failed'));
		}
	})();
}
