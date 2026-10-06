import { releasePromptQueueCommand } from '$lib/chat/application/commands/release-prompt-queue.command';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import {
	activeWorkstreamsQuery,
	workstreamReadyForPromptsQuery,
} from '$shared/repositories/repositories.api';
import { untrack } from 'svelte';

export function releaseReopenedPromptQueuesHook(): () => void {
	return $effect.root(() => {
		$effect(() => {
			void activeWorkstreamsQuery.data;
			const ready = workstreamReadyForPromptsQuery.data;
			untrack(() => {
				for (const workstreamId of agentPromptQueue.workstreamsWithEntries()) {
					if (ready(workstreamId)) releasePromptQueueCommand(workstreamId);
				}
			});
		});
	});
}
