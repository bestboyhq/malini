import type { ChatRequestId } from '$lib/chat/domain/chat-request';
import {
	MAX_COMPOSER_ATTACHMENTS,
	mergeComposerAttachments,
	type StagedAgentAttachment,
} from '$lib/chat/domain/composer-actions';
import { errorMessage } from '$lib/chat/domain/error-message';
import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';
import { composerAttachments } from '$lib/chat/infrastructure/services/composer-attachments.service';
import { chatRequestsStore } from '$lib/chat/infrastructure/stores/chat-requests.store.svelte';

export { stageClipboardAttachmentsCommand };

function stageClipboardAttachmentsCommand(
	input: Readonly<{
		requestId: ChatRequestId;
		workstreamId: string;
		draftScope: string;
		files: readonly Readonly<{ fileName: string; file: File }>[];
	}>,
): void {
	chatRequestsStore.begin(input.requestId);
	void (async () => {
		try {
			const current = agentDrafts.draftFor(input.draftScope).attachments;
			const known = new Set(current.map((attachment) => attachment.id));
			const staged: StagedAgentAttachment[] = [];
			for (const candidate of input.files) {
				if (known.size >= MAX_COMPOSER_ATTACHMENTS) break;
				const attachment = await composerAttachments.stageFile(
					input.workstreamId,
					candidate.fileName,
					candidate.file,
				);
				known.add(attachment.id);
				staged.push(attachment);
			}
			agentDrafts.setAttachments(
				input.draftScope,
				mergeComposerAttachments(agentDrafts.draftFor(input.draftScope).attachments, staged),
			);
			chatRequestsStore.accept(input.requestId);
		} catch (error) {
			chatRequestsStore.fail(
				input.requestId,
				errorMessage(error, 'Could not attach the pasted file'),
			);
		}
	})();
}
