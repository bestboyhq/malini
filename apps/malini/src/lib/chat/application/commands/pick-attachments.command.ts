import type { ChatRequestId } from '$lib/chat/domain/chat-request';
import { mergeComposerAttachments } from '$lib/chat/domain/composer-actions';
import { errorMessage } from '$lib/chat/domain/error-message';
import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';
import { composerAttachments } from '$lib/chat/infrastructure/services/composer-attachments.service';
import { chatRequestsStore } from '$lib/chat/infrastructure/stores/chat-requests.store.svelte';

export { pickAttachmentsCommand };

function pickAttachmentsCommand(
	input: Readonly<{ requestId: ChatRequestId; workstreamId: string; draftScope: string }>,
): void {
	chatRequestsStore.begin(input.requestId);
	void (async () => {
		try {
			const selected = await composerAttachments.pickAndStage(input.workstreamId);
			agentDrafts.setAttachments(
				input.draftScope,
				mergeComposerAttachments(agentDrafts.draftFor(input.draftScope).attachments, selected),
			);
			chatRequestsStore.accept(input.requestId);
		} catch (error) {
			chatRequestsStore.fail(
				input.requestId,
				errorMessage(error, 'Could not stage selected files'),
			);
		}
	})();
}
