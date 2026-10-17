import {
	summarizeWorkstreamChat,
	type WorkstreamChatSummary,
} from '$lib/chat/domain/workstream-chat-summary';
import {
	preferredVisualSessionsByWorkstream,
	workstreamsRunningJobs,
} from '$lib/chat/domain/workstream-visual-session';
import { agentActivity } from '$lib/chat/infrastructure/aggregates/agent-activity.aggregate.svelte';
import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { chatOccupancy } from '$lib/chat/infrastructure/services/chat-occupancy.service';

export { workstreamChatSummaryQuery };

class WorkstreamChatSummaryQuery {
	public readonly data: (workstreamId: string) => WorkstreamChatSummary = $derived.by(() => {
		const sessions = sessionsAggregate.listSessions();
		const visualSessions = preferredVisualSessionsByWorkstream(sessions);
		const runningJobs = workstreamsRunningJobs(sessions);
		return (workstreamId: string) => {
			const session = visualSessions.get(workstreamId) ?? null;
			return summarizeWorkstreamChat({
				session,
				openingSessionId: sessionsAggregate.openingSessionFor(workstreamId),
				waitingOnBackground:
					session?.status === 'running' &&
					chatOccupancy.backgroundWork(session.id)?.waiting === true,
				jobRunning: runningJobs.has(workstreamId),
				queueCount: agentPromptQueue.waitingCountFor(workstreamId),
				attention: agentActivity.attentionFor(workstreamId),
				hasDraft: agentDrafts.hasDraftForWorkstream(workstreamId),
			});
		};
	});
}

const workstreamChatSummaryQuery = new WorkstreamChatSummaryQuery();
