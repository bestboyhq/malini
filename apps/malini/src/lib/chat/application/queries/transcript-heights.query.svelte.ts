import type { SessionId } from '$lib/chat/domain/session';
import { transcriptHeights } from '$lib/chat/infrastructure/stores/transcript-heights.store';

export { transcriptHeightsQuery };

class TranscriptHeightsQuery {
	public readonly data: (sessionId: SessionId) => ReadonlyMap<string, number> = $derived(
		(sessionId: SessionId) => transcriptHeights.heightsFor(sessionId),
	);
}

const transcriptHeightsQuery = new TranscriptHeightsQuery();
