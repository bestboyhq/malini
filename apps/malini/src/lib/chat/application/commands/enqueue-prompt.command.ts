import type { PromptTurn } from '$lib/chat/domain/prompt-submission';
import type { QueuedPrompt } from '$lib/chat/domain/queued-prompt';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { writeChatSetup } from '$lib/chat/infrastructure/services/model-preferences.storage';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export { enqueuePromptCommand };

function enqueuePromptCommand(turn: PromptTurn): QueuedPrompt {
	const entry = agentPromptQueue.enqueue({
		workstreamId: turn.workstreamId,
		targetSessionId: turn.sessionId,
		forceFreshSession: turn.forceFreshSession,
		prompt: turn.prompt,
		role: turn.role,
		provider: turn.provider,
		model: turn.model,
		profile: turn.profile,
		contextFiles: turn.contextFiles,
		attachments: turn.attachments,
		transcriptReferences: turn.transcriptReferences,
		elementReferences: turn.elementReferences,
		automated: turn.automated === true,
	});
	const setup = {
		selection: { provider: turn.provider, model: turn.model },
		profile: turn.profile,
	};
	if (turn.sessionId) writeChatSetup(turn.sessionId, setup);
	if (
		chatRoute.workstreamId === turn.workstreamId &&
		chatSessionStore.sessionId === turn.sessionId
	) {
		chatModelStore.show(setup);
	}
	return entry;
}
