import { submitPromptCommand } from '$lib/chat/application/commands/submit-prompt.command';
import type { ChatRequestId } from '$lib/chat/domain/chat-request';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { defaultAgentModel } from '$shared/providers/providers.api';

export { submitWorkstreamPromptCommand };

function submitWorkstreamPromptCommand(
	request: Readonly<{
		requestId: ChatRequestId;
		workstreamId: string;
		prompt: string;
		automated: boolean;
	}>,
): void {
	const sessionId = chatSessionStore.sessionId;
	submitPromptCommand({
		requestId: request.requestId,
		workstreamId: request.workstreamId,
		sessionId,
		forceFreshSession:
			chatSessionStore.emptySessionMode === 'fresh' ||
			(chatSessionStore.createFreshSessionOnNextPrompt && sessionId !== null),
		prompt: request.prompt,
		model: chatModelStore.model ?? defaultAgentModel(),
		profile: { ...chatModelStore.profile },
		contextFiles: [],
		attachments: [],
		issueReferences: [],
		transcriptReferences: [],
		elementReferences: [],
		automated: request.automated,
	});
}
