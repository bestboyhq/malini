import { submitPromptCommand } from '$lib/chat/application/commands/submit-prompt.command';
import { newChatRequestId } from '$lib/chat/domain/chat-request';
import {
	captureCheckpointEditTarget,
	executeCheckpointEdit,
	type CheckpointEditTarget,
} from '$lib/chat/domain/checkpoint-edit-target';
import type { EditCheckpointRequest } from '$lib/chat/domain/checkpoint-requests';
import { errorMessage } from '$lib/chat/domain/error-message';
import { checkpoints } from '$lib/chat/infrastructure/services/checkpoint.service';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatRequestsStore } from '$lib/chat/infrastructure/stores/chat-requests.store.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { defaultAgentModel } from '$shared/providers/providers.api';

export { editCheckpointCommand };

function editCheckpointCommand(request: EditCheckpointRequest): void {
	chatRequestsStore.begin(request.requestId);
	const target = captureCheckpointEditTarget({
		workstreamId: chatRoute.workstreamId,
		sessionId: chatSessionStore.sessionId,
		model: chatModelStore.model ?? defaultAgentModel(),
		profile: chatModelStore.profile,
	});
	const selectionGeneration = chatSessionStore.selectionGeneration;
	void (async () => {
		try {
			if (!target) throw new Error('Agent session is not ready');
			const completed = await executeCheckpointEdit(target, {
				restore: (captured) =>
					checkpoints.rewind(request.checkpointId, captured, selectionGeneration),
				isCurrent: (captured) => checkpoints.targetIsCurrent(captured),
				submit: (captured) => resubmit(request, captured),
			});
			if (!completed) {
				throw new Error(
					'Checkpoint restored, but the edit was cancelled because the active chat changed',
				);
			}
			chatRequestsStore.accept(request.requestId);
		} catch (error) {
			chatRequestsStore.fail(request.requestId, errorMessage(error, 'Message edit failed'));
		}
	})();
}

async function resubmit(
	request: EditCheckpointRequest,
	target: CheckpointEditTarget,
): Promise<void> {
	const requestId = newChatRequestId();
	submitPromptCommand({
		requestId,
		workstreamId: target.workstreamId,
		sessionId: target.sessionId,
		forceFreshSession: false,
		prompt: request.prompt,
		model: target.model,
		profile: target.profile,
		contextFiles: request.contextFiles,
		attachments: request.attachments,
		issueReferences: request.issueReferences,
		transcriptReferences: request.transcriptReferences,
		elementReferences: request.elementReferences,
	});
	const outcome = await chatRequestsStore.settled(requestId);
	if (outcome.status === 'failed') throw new Error(outcome.error);
}
