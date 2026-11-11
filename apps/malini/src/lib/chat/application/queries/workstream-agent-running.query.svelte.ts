import { isAgentWorking } from '$contract/agent-state-machine';
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
					(chatSessionStore.isDispatchPending(session.id) || isAgentWorking(session.status)),
			),
	);
}

const workstreamAgentRunningQuery = new WorkstreamAgentRunningQuery();
