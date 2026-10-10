import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { transcriptAggregate } from '$lib/chat/infrastructure/aggregates/transcript.aggregate.svelte';
import { transcriptAnchors } from '$lib/chat/infrastructure/stores/transcript-anchors.store';
import { workstreamChatsPreloader } from '$lib/chat/infrastructure/services/workstream-chats-preloader.service';

export { forgetWorkstreamChatsCommand };

function forgetWorkstreamChatsCommand(workstreamId: string): void {
	if (!workstreamId) return;
	const sessionIds = sessionsAggregate
		.listSessions()
		.filter((session) => session.workstreamId === workstreamId)
		.map((session) => session.id);
	sessionsAggregate.reconcileWorkstreamSessions(workstreamId, new Set());
	for (const sessionId of sessionIds) transcriptAggregate.forgetSession(sessionId);
	transcriptAnchors.forget(sessionIds);
	agentPromptQueue.clear(workstreamId);
	workstreamChatsPreloader.forget(workstreamId, sessionIds);
}
