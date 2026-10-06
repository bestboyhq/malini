import type { EventEnvelope } from '$lib/chat/domain/events';
import { agentInteractionCommands } from '$lib/chat/infrastructure/aggregates/agent-interactions.aggregate.svelte';

export { syncInteractionsCommand };

function syncInteractionsCommand(sessionId: string, envelopes: readonly EventEnvelope[]): void {
	agentInteractionCommands.syncSession(sessionId, envelopes);
}
