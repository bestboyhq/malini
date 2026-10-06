import type { ChatRequestId } from '$lib/chat/domain/chat-request';
import { agentDraftScopeKey } from '$lib/chat/domain/draft';
import { errorMessage } from '$lib/chat/domain/error-message';
import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';
import { composerAttachments } from '$lib/chat/infrastructure/services/composer-attachments.service';
import { sessionActivation } from '$lib/chat/infrastructure/services/session-activation.service';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatRequestsStore } from '$lib/chat/infrastructure/stores/chat-requests.store.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { defaultAgentModel } from '$shared/providers/providers.api';

export { forkToNewChatCommand };

function forkToNewChatCommand(
	request: Readonly<{ requestId: ChatRequestId; atSeq: number }>,
): void {
	chatRequestsStore.begin(request.requestId);
	const workstreamId = chatRoute.workstreamId;
	const sessionId = chatSessionStore.sessionId ?? chatRoute.readSessionParam();
	void (async () => {
		try {
			if (!workstreamId || !sessionId) throw new Error('Agent session is not ready');
			const transcript = await composerAttachments.stageForkTranscript(
				workstreamId,
				sessionId,
				request.atSeq,
			);
			const forked = await sessionActivation.mint({
				workstreamId,
				role: chatModelStore.profile.mode === 'plan' ? 'planning' : 'implementation',
				selection: { model: chatModelStore.model ?? defaultAgentModel() },
				activate: false,
			});
			agentDrafts.setAttachments(agentDraftScopeKey(workstreamId, forked), [transcript]);
			if (chatRoute.workstreamId === workstreamId) {
				await sessionActivation.activate(forked, workstreamId);
			}
			chatRequestsStore.accept(request.requestId);
		} catch (error) {
			chatRequestsStore.fail(request.requestId, errorMessage(error, 'Fork failed'));
		}
	})();
}
