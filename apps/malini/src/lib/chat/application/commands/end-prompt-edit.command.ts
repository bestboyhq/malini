import type { StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';
import { composerAttachments } from '$lib/chat/infrastructure/services/composer-attachments.service';

export { endPromptEditCommand };

function endPromptEditCommand(
	input: Readonly<{
		workstreamId: string;
		scope: string;
		keep: readonly StagedAgentAttachment[];
	}>,
): void {
	const kept = new Set(input.keep.map(({ id }) => id));
	const touched = [
		...agentDrafts.draftFor(input.scope).attachments,
		...agentDrafts.takeDetached(input.scope),
	];
	composerAttachments.release(
		input.workstreamId,
		touched.filter(({ id }) => !kept.has(id)),
	);
	agentDrafts.clear(input.scope);
}
