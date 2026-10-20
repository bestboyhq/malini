import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';

export { reattachAttachmentsCommand };

function reattachAttachmentsCommand(input: Readonly<{ draftScope: string; prompt: string }>): void {
	agentDrafts.reattachReferenced(input.draftScope, input.prompt);
}
