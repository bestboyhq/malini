import type { SessionId } from '$lib/chat/domain/session';
import { agentDraftScopeKey } from '$lib/chat/domain/draft';
import { agentActivity } from '$lib/chat/infrastructure/aggregates/agent-activity.aggregate.svelte';
import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';
import { composerAttachments } from '$lib/chat/infrastructure/services/composer-attachments.service.svelte';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { transcriptAggregate } from '$lib/chat/infrastructure/aggregates/transcript.aggregate.svelte';
import { transcriptAnchors } from '$lib/chat/infrastructure/stores/transcript-anchors.store';
import { transcriptHeights } from '$lib/chat/infrastructure/stores/transcript-heights.store';
import { workstreamChatsPreloader } from '$lib/chat/infrastructure/services/workstream-chats-preloader.service';

export { forgetChatCommand };

function forgetChatCommand(workstreamId: string, sessionId: SessionId): void {
	agentPromptQueue.removeForSession(workstreamId, sessionId);
	const draftScope = agentDraftScopeKey(workstreamId, sessionId);
	composerAttachments.release(workstreamId, [
		...agentDrafts.draftFor(draftScope).attachments,
		...agentDrafts.takeDetached(draftScope),
	]);
	agentDrafts.clear(draftScope);
	sessionsAggregate.removeSession(sessionId);
	agentActivity.clearChat(sessionId);
	transcriptAggregate.forgetSession(sessionId);
	transcriptAnchors.forget([sessionId]);
	transcriptHeights.forget([sessionId]);
	workstreamChatsPreloader.forgetChat(sessionId);
}
