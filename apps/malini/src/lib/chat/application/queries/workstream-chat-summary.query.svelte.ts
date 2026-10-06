import {
	summarizeWorkstreamChat,
	type WorkstreamChatSummary,
} from '$lib/chat/domain/workstream-chat-summary';
import { preferredVisualSessionsByWorkstream } from '$lib/chat/domain/workstream-visual-session';
import { agentActivity } from '$lib/chat/infrastructure/aggregates/agent-activity.aggregate.svelte';
import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';

export { workstreamChatSummaryQuery };

class WorkstreamChatSummaryQuery {
	public readonly data: (workstreamId: string) => WorkstreamChatSummary = $derived.by(() => {
		const visualSessions = preferredVisualSessionsByWorkstream(sessionsAggregate.listSessions());
		return (workstreamId: string) =>
			summarizeWorkstreamChat({
				session: visualSessions.get(workstreamId) ?? null,
				queueCount: agentPromptQueue.waitingCountFor(workstreamId),
				attention: agentActivity.attentionFor(workstreamId),
				hasDraft: agentDrafts.hasDraftForWorkstream(workstreamId),
			});
	});
}

const workstreamChatSummaryQuery = new WorkstreamChatSummaryQuery();
