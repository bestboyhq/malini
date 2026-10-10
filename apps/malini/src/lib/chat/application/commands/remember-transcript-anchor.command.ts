import type { SessionId } from '$lib/chat/domain/session';
import type { TranscriptAnchor } from '$lib/chat/domain/transcript-anchor';
import { transcriptAnchors } from '$lib/chat/infrastructure/stores/transcript-anchors.store';

export { rememberTranscriptAnchorCommand };

function rememberTranscriptAnchorCommand(
	sessionId: SessionId,
	anchor: TranscriptAnchor | null,
): void {
	transcriptAnchors.remember(sessionId, anchor);
}
