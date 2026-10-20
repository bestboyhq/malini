import type { SessionId } from '$lib/chat/domain/session';
import { transcriptHeights } from '$lib/chat/infrastructure/stores/transcript-heights.store';

export { rememberTranscriptHeightsCommand };

function rememberTranscriptHeightsCommand(
	sessionId: SessionId,
	heights: ReadonlyMap<string, number>,
): void {
	transcriptHeights.remember(sessionId, heights);
}
