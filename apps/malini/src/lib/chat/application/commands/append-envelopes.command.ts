import { drainPromptQueueCommand } from '$lib/chat/application/commands/drain-prompt-queue.command';
import type { EventEnvelope } from '$lib/chat/domain/events';
import type { SessionId } from '$lib/chat/domain/session';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { transcriptAggregate } from '$lib/chat/infrastructure/aggregates/transcript.aggregate.svelte';
import { sessionActivation } from '$lib/chat/infrastructure/services/session-activation.service';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { pendingPromptStore } from '$lib/chat/infrastructure/stores/pending-prompt.store.svelte';

export { appendEnvelopesCommand };

function appendEnvelopesCommand(batch: readonly EventEnvelope[]): void {
	if (batch.length === 0) return;
	const sessionIds = new Set<SessionId>(batch.map((envelope) => envelope.sessionId));
	for (const sessionId of sessionIds) sessionActivation.ensureRecord(sessionId);

	const accepted = transcriptAggregate.append(batch);
	if (accepted.length === 0) return;

	for (const sessionId of sessionIds) {
		if (!transcriptAggregate.isReadinessDeferred(sessionId)) {
			transcriptAggregate.markReady(sessionId);
		}
	}
	sessionsAggregate.applyEventBatch(accepted);
	for (const envelope of accepted) {
		if (envelope.event.type === 'user.message' && envelope.event.clientRequestId) {
			const workstreamId = ownerOf(envelope.sessionId);
			if (workstreamId) agentPromptQueue.remove(workstreamId, envelope.event.clientRequestId);
		}
		if (
			envelope.event.type === 'run.started' ||
			envelope.event.type === 'run.completed' ||
			envelope.event.type === 'run.failed'
		) {
			chatSessionStore.setDispatchPending(envelope.sessionId, false);
		}
		pendingPromptStore.clearOnEnvelope(envelope);
		if (envelope.event.type === 'run.completed' || envelope.event.type === 'run.failed') {
			const workstreamId = ownerOf(envelope.sessionId);
			if (workstreamId) drainPromptQueueCommand(workstreamId);
		}
	}
}

function ownerOf(sessionId: SessionId): string | null {
	const owner =
		transcriptAggregate.ownerOf(sessionId) ?? sessionsAggregate.getSession(sessionId)?.workstreamId;
	return owner && owner !== '_unknown' ? owner : null;
}
