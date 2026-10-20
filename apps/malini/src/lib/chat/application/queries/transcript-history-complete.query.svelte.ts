import type { SessionId } from '$lib/chat/domain/session';
import { transcriptHistoryAggregate } from '$lib/chat/infrastructure/aggregates/transcript-history.aggregate.svelte';

export { transcriptHistoryCompleteQuery };

class TranscriptHistoryCompleteQuery {
	public readonly data: (sessionId: SessionId) => boolean = $derived((sessionId: SessionId) =>
		transcriptHistoryAggregate.completeSessions.has(sessionId),
	);
}

const transcriptHistoryCompleteQuery = new TranscriptHistoryCompleteQuery();
