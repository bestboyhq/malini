import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { composerAttachments } from '$lib/chat/infrastructure/services/composer-attachments.service.svelte';

export { renewHeldAttachmentsCommand };

function renewHeldAttachmentsCommand(workstreamIds: readonly string[]): void {
	for (const workstreamId of workstreamIds) {
		const held = new Set([
			...agentDrafts.attachmentsForWorkstream(workstreamId).map(({ id }) => id),
			...agentPromptQueue
				.entriesFor(workstreamId)
				.flatMap(({ attachments }) => attachments.map(({ id }) => id)),
		]);
		if (held.size > 0) composerAttachments.renew(workstreamId, [...held]);
	}
}
