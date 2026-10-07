import type { PromptTurn } from '$lib/chat/domain/prompt-submission';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { writeStoredRunProfile } from '$lib/chat/infrastructure/services/model-preferences.storage';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';

export { enqueuePromptCommand };

function enqueuePromptCommand(turn: PromptTurn): void {
	agentPromptQueue.enqueue({
		workstreamId: turn.workstreamId,
		targetSessionId: turn.sessionId,
		forceFreshSession: turn.forceFreshSession,
		prompt: turn.prompt,
		role: turn.role,
		model: turn.model,
		profile: turn.profile,
		contextFiles: turn.contextFiles,
		attachments: turn.attachments,
		issueReferences: turn.issueReferences,
		transcriptReferences: turn.transcriptReferences,
		elementReferences: turn.elementReferences,
		automated: turn.automated === true,
	});
	chatModelStore.rememberRoleSelection(turn.role, { model: turn.model });
	writeStoredRunProfile(turn.workstreamId, turn.profile);
	if (chatRoute.workstreamId === turn.workstreamId) {
		chatModelStore.model = turn.model;
		chatModelStore.profile = { ...turn.profile };
	}
}
