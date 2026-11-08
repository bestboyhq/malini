import { releasePromptQueueCommand } from '$lib/chat/application/commands/release-prompt-queue.command';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { claudeCodeStatusQuery, providerGroupsQuery } from '$shared/providers/providers.api';
import {
	activeWorkstreamsQuery,
	workstreamReadyForPromptsQuery,
} from '$shared/repositories/repositories.api';
import { untrack } from 'svelte';

export function releaseWaitingPromptQueuesHook(): () => void {
	return $effect.root(() => {
		$effect(() => {
			void activeWorkstreamsQuery.data;
			void providerGroupsQuery.data;
			void claudeCodeStatusQuery.data;
			const ready = workstreamReadyForPromptsQuery.data;
			untrack(() => {
				for (const workstreamId of agentPromptQueue.workstreamsWithEntries()) {
					if (ready(workstreamId)) releasePromptQueueCommand(workstreamId);
				}
			});
		});
	});
}
