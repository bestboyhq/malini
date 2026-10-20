import { drainPromptQueueCommand } from '$lib/chat/application/commands/drain-prompt-queue.command';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { transcriptAggregate } from '$lib/chat/infrastructure/aggregates/transcript.aggregate.svelte';

export { pausePromptQueueCommand };

function pausePromptQueueCommand(workstreamId: string, paused: boolean): void {
	agentPromptQueue.setPaused(workstreamId, paused);
	if (paused) return;
	const ownedSessionId = Object.entries(transcriptAggregate.ownerBySession).find(
		([, owner]) => owner === workstreamId,
	)?.[0];
	if (ownedSessionId) drainPromptQueueCommand(workstreamId);
}
