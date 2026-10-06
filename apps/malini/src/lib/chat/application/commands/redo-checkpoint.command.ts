import type { RedoCheckpointRequest } from '$lib/chat/domain/checkpoint-requests';
import { errorMessage } from '$lib/chat/domain/error-message';
import { checkpoints } from '$lib/chat/infrastructure/services/checkpoint.service';
import { sessionActivation } from '$lib/chat/infrastructure/services/session-activation.service';
import { chatRequestsStore } from '$lib/chat/infrastructure/stores/chat-requests.store.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export { redoCheckpointCommand };

function redoCheckpointCommand(request: RedoCheckpointRequest): void {
	chatRequestsStore.begin(request.requestId);
	const workstreamId = chatRoute.workstreamId;
	const sessionId = chatSessionStore.sessionId ?? chatRoute.readSessionParam();
	void (async () => {
		try {
			if (!workstreamId || !sessionId) throw new Error('Agent session is not ready');
			await checkpoints.redo({ workstreamId, sessionId, restoreSeq: request.restoreSeq });
			await sessionActivation.hydrate(sessionId);
			chatRequestsStore.accept(request.requestId);
		} catch (error) {
			chatRequestsStore.fail(request.requestId, errorMessage(error, 'Redo failed'));
		}
	})();
}
