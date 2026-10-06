import type { EventEnvelope } from '$lib/chat/domain/events';
import type { SessionId } from '$lib/chat/domain/session';
import { transcriptAggregate } from '$lib/chat/infrastructure/aggregates/transcript.aggregate.svelte';

export { sessionEnvelopesQuery };

const NO_ENVELOPES: readonly EventEnvelope[] = [];

class SessionEnvelopesQuery {
	public readonly data: (sessionId: SessionId | null) => readonly EventEnvelope[] = $derived(
		(sessionId: SessionId | null) =>
			sessionId ? transcriptAggregate.envelopesFor(sessionId) : NO_ENVELOPES,
	);
}

const sessionEnvelopesQuery = new SessionEnvelopesQuery();
