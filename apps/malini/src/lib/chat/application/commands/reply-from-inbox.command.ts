import { submitPromptCommand } from '$lib/chat/application/commands/submit-prompt.command';
import type { ChatRequestId } from '$lib/chat/domain/chat-request';
import { agentActivity } from '$lib/chat/infrastructure/aggregates/agent-activity.aggregate.svelte';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { readStoredRunProfile } from '$lib/chat/infrastructure/services/model-preferences.storage';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatRequestsStore } from '$lib/chat/infrastructure/stores/chat-requests.store.svelte';

export { replyFromInboxCommand };

function replyFromInboxCommand(
	request: Readonly<{ requestId: ChatRequestId; workstreamId: string; prompt: string }>,
): void {
	const sessionId = agentActivity.attentionFor(request.workstreamId)?.sessionId;
	const session = sessionId ? sessionsAggregate.getSession(sessionId) : null;
	submitPromptCommand({
		requestId: request.requestId,
		workstreamId: request.workstreamId,
		sessionId: session?.id ?? null,
		forceFreshSession: false,
		prompt: request.prompt,
		model: chatModelStore.selectionForSession(session ?? { model: null }).model,
		profile: readStoredRunProfile(request.workstreamId),
		contextFiles: [],
		attachments: [],
		issueReferences: [],
		transcriptReferences: [],
		elementReferences: [],
		automated: false,
	});
	void (async () => {
		const outcome = await chatRequestsStore.settled(request.requestId);
		if (outcome.status === 'accepted') agentActivity.clear(request.workstreamId);
	})();
}
