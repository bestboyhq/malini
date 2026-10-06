import type { EventEnvelope } from '$lib/chat/domain/events';
import type { SessionId } from '$lib/chat/domain/session';
import { transcriptAggregate } from '$lib/chat/infrastructure/aggregates/transcript.aggregate.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';

export { presentedTranscriptQuery };

class PresentedTranscriptQuery {
	public readonly data: Readonly<{
		workstreamId: string;
		sessionId: SessionId | null;
		envelopes: readonly EventEnvelope[];
	}> = $derived.by(() => {
		const retained = transcriptAggregate.retainedPresentation;
		const presented =
			transcriptAggregate.targetPresentation ??
			(retained?.workstreamId === chatRoute.workstreamId &&
			(chatRoute.requestedSessionId === null ||
				retained.sessionId === chatRoute.requestedSessionId) &&
			transcriptAggregate.isReady(retained.sessionId)
				? retained
				: null);
		return {
			workstreamId: presented?.workstreamId ?? chatRoute.workstreamId,
			sessionId: presented?.sessionId ?? null,
			envelopes: presented ? transcriptAggregate.envelopesFor(presented.sessionId) : EMPTY,
		};
	});
}

const EMPTY: readonly EventEnvelope[] = [];

const presentedTranscriptQuery = new PresentedTranscriptQuery();
