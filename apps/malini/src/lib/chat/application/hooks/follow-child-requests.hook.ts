import { requestEnvelopes } from '$lib/chat/domain/child-requests';
import type { SessionId } from '$lib/chat/domain/session';
import { agentInteractionCommands } from '$lib/chat/infrastructure/aggregates/agent-interactions.aggregate.svelte';
import { childRequestsAggregate } from '$lib/chat/infrastructure/aggregates/child-requests.aggregate.svelte';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';
import { captureRendererError } from '$shared/errors/renderer-error-sink';

export function followChildRequestsHook(sessionId: SessionId): () => void {
	let followed = true;
	void (async () => {
		try {
			// ponytail: reads the child's whole latest run to find its open requests; a kind filter on chat.list-event-page trims the transfer
			const latestRun = await agentSessions.listEventPage(sessionId, {
				afterSeq: 0,
				beforeSeq: null,
				byteBudget: 0,
			});
			if (!followed) return;
			const envelopes = requestEnvelopes(latestRun.envelopes);
			agentInteractionCommands.syncSession(sessionId, envelopes);
			childRequestsAggregate.set(sessionId, envelopes);
		} catch (error) {
			captureRendererError('caught', error);
		}
	})();
	return () => {
		followed = false;
		childRequestsAggregate.forget(sessionId);
	};
}
