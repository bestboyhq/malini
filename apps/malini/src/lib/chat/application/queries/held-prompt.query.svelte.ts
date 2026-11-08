import type { QueuedPrompt } from '$lib/chat/domain/queued-prompt';
import type { SessionId } from '$lib/chat/domain/session';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { isModelAccessReady, modelAccessQuery } from '$shared/providers/providers.api';

export { heldPromptQuery };

class HeldPromptQuery {
	public readonly data: (workstreamId: string, sessionId: SessionId | null) => QueuedPrompt | null =
		$derived(
			(workstreamId: string, sessionId: SessionId | null) =>
				agentPromptQueue.waitingEntriesForSession(workstreamId, sessionId).find(isHeld) ?? null,
		);

	public readonly countFor: (workstreamId: string) => number = $derived(
		(workstreamId: string) => agentPromptQueue.entriesFor(workstreamId).filter(isHeld).length,
	);
}

function isHeld(entry: QueuedPrompt): boolean {
	return (
		entry.targetSessionId !== null &&
		!entry.forceFreshSession &&
		!isModelAccessReady(modelAccessQuery.data(entry))
	);
}

const heldPromptQuery = new HeldPromptQuery();
