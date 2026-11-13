import { isWaitingForUser, type SessionStatus } from '$contract/agent-state-machine';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export { workstreamAgentStatusQuery };

class WorkstreamAgentStatusQuery {
	public readonly data: (workstreamId: string) => SessionStatus | null = $derived(
		(workstreamId: string) => {
			const sessions = sessionsAggregate
				.listSessions()
				.filter((session) => session.workstreamId === workstreamId);
			if (sessions.some((session) => isWaitingForUser(session.status))) {
				return 'waiting_for_approval';
			}
			return sessions.some(
				(session) => chatSessionStore.isDispatchPending(session.id) || session.status === 'running',
			)
				? 'running'
				: null;
		},
	);
}

const workstreamAgentStatusQuery = new WorkstreamAgentStatusQuery();
