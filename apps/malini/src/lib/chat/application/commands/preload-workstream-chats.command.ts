import { releasePromptQueueCommand } from '$lib/chat/application/commands/release-prompt-queue.command';
import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { workstreamChatsPreloader } from '$lib/chat/infrastructure/services/workstream-chats-preloader.service';
import { workstreamReadyForPromptsQuery } from '$shared/repositories/repositories.api';

export { preloadWorkstreamChatsCommand };

function preloadWorkstreamChatsCommand(workstreamIds: readonly string[]): void {
	for (const workstreamId of workstreamIds) {
		agentPromptQueue.hydrate(workstreamId);
		agentDrafts.hydrateWorkstream(workstreamId);
	}
	workstreamChatsPreloader.preload(workstreamIds);
	for (const workstreamId of workstreamIds) {
		if (workstreamReadyForPromptsQuery.data(workstreamId)) releasePromptQueueCommand(workstreamId);
	}
}
