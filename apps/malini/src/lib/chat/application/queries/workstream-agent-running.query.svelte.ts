import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export { workstreamAgentRunningQuery };

class WorkstreamAgentRunningQuery {
	public readonly data: (workstreamId: string) => boolean = $derived((workstreamId: string) =>
		sessionsAggregate
			.listSessions()
			.some(
				(session) =>
					session.workstreamId === workstreamId &&
					(session.status === 'running' ||
						session.status === 'waiting_for_approval' ||
						chatSessionStore.isDispatchPending(session.id)),
			),
	);
}

const workstreamAgentRunningQuery = new WorkstreamAgentRunningQuery();
