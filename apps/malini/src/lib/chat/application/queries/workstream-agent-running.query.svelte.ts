import { backgroundWaitOf } from '$lib/chat/domain/background-work';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { chatOccupancy } from '$lib/chat/infrastructure/services/chat-occupancy.service';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export { workstreamAgentRunningQuery, type WorkstreamAgentWork };

type WorkstreamAgentWork = 'agent' | 'commands';

class WorkstreamAgentRunningQuery {
	public readonly data: (workstreamId: string) => WorkstreamAgentWork | null = $derived(
		(workstreamId: string) => {
			let work: WorkstreamAgentWork | null = null;
			for (const session of sessionsAggregate.listSessions()) {
				if (session.workstreamId !== workstreamId) continue;
				if (chatSessionStore.isDispatchPending(session.id)) return 'agent';
				if (session.status === 'waiting_for_approval') return 'agent';
				if (session.status !== 'running') continue;
				if (backgroundWaitOf(chatOccupancy.backgroundWork(session.id)) !== 'commands')
					return 'agent';
				work = 'commands';
			}
			return work;
		},
	);
}

const workstreamAgentRunningQuery = new WorkstreamAgentRunningQuery();
