import type { SessionId } from '$lib/chat/domain/session';
import type { TranscriptAnchor } from '$lib/chat/domain/transcript-anchor';
import { transcriptAnchors } from '$lib/chat/infrastructure/stores/transcript-anchors.store';

export { transcriptAnchorQuery };

class TranscriptAnchorQuery {
	public readonly data: (sessionId: SessionId) => TranscriptAnchor | null = $derived(
		(sessionId: SessionId) => transcriptAnchors.anchorFor(sessionId),
	);
}

const transcriptAnchorQuery = new TranscriptAnchorQuery();
