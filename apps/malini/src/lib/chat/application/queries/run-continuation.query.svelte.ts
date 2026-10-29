import type { AgentSessionOrigin } from '$contract/agent';
import type { SessionId } from '$lib/chat/domain/session';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export { runContinuationQuery };

class RunContinuationQuery {
	public readonly continuing: boolean = $derived(chatSessionStore.continuingRun);
	public readonly origin: (sessionId: SessionId) => AgentSessionOrigin | null = $derived(
		(sessionId: SessionId) => sessionsAggregate.getSession(sessionId)?.origin ?? null,
	);
}

const runContinuationQuery = new RunContinuationQuery();
