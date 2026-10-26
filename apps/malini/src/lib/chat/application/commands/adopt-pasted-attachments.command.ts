import type { ChatRequestId } from '$lib/chat/domain/chat-request';
import {
	mergeComposerAttachments,
	type StagedAgentAttachment,
} from '$lib/chat/domain/composer-actions';
import { errorMessage } from '$lib/chat/domain/error-message';
import { rewritePromptChips } from '$lib/chat/domain/prompt-chip';
import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';
import { composerAttachments } from '$lib/chat/infrastructure/services/composer-attachments.service.svelte';
import { chatRequestsStore } from '$lib/chat/infrastructure/stores/chat-requests.store.svelte';

export { adoptPastedAttachmentsCommand };

function adoptPastedAttachmentsCommand(
	input: Readonly<{
		requestId: ChatRequestId;
		workstreamId: string;
		draftScope: string;
		attachmentIds: readonly string[];
	}>,
): void {
	chatRequestsStore.begin(input.requestId);
	void (async () => {
		try {
			const adopted = await composerAttachments.adopt(input.workstreamId, input.attachmentIds);
			const copies = new Map<string, StagedAgentAttachment>();
			const failures: string[] = [];
			for (const result of adopted) {
				if ('attachment' in result) copies.set(result.sourceId, result.attachment);
				else failures.push(result.error);
			}
			const pasted = new Set(input.attachmentIds);
			const draft = agentDrafts.draftFor(input.draftScope);
			agentDrafts.setText(
				input.draftScope,
				rewritePromptChips(draft.text, 'attachment', (id) =>
					pasted.has(id) ? (copies.get(id)?.id ?? null) : id,
				),
			);
			agentDrafts.setAttachments(
				input.draftScope,
				mergeComposerAttachments(draft.attachments, [...copies.values()]),
			);
			if (failures.length === 0) chatRequestsStore.accept(input.requestId);
			else chatRequestsStore.fail(input.requestId, `Could not attach: ${failures.join('; ')}`);
		} catch (error) {
			chatRequestsStore.fail(
				input.requestId,
				errorMessage(error, 'Could not attach the pasted files'),
			);
		}
	})();
}
