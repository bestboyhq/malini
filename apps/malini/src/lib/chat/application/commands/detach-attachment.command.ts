import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';

export { detachAttachmentCommand };

function detachAttachmentCommand(
	input: Readonly<{ draftScope: string; attachmentId: string }>,
): void {
	agentDrafts.detachAttachment(input.draftScope, input.attachmentId);
}
