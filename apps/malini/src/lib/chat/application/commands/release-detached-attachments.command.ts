import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';
import { composerAttachments } from '$lib/chat/infrastructure/services/composer-attachments.service';

export { releaseDetachedAttachmentsCommand };

function releaseDetachedAttachmentsCommand(
	input: Readonly<{ workstreamId: string; draftScope: string }>,
): void {
	composerAttachments.release(input.workstreamId, agentDrafts.takeDetached(input.draftScope));
}
