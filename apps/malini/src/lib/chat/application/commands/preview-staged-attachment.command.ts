import { isImageAttachment, type StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
import { errorMessage } from '$lib/chat/domain/error-message';
import { imagePreviewKey } from '$lib/chat/domain/image-preview';
import { composerAttachments } from '$lib/chat/infrastructure/services/composer-attachments.service';
import { imagePreviewsStore } from '$lib/chat/infrastructure/stores/image-previews.store.svelte';

export { previewStagedAttachmentCommand };

const NO_PREVIEW = 'This attachment has no preview';

function previewStagedAttachmentCommand(
	input: Readonly<{ owner: string; workstreamId: string; attachment: StagedAgentAttachment }>,
): void {
	if (!isImageAttachment(input.attachment)) return;
	const key = imagePreviewKey(input.owner, input.attachment.id);
	const read = imagePreviewsStore.begin(key);
	if (read === null) return;
	void (async () => {
		try {
			const bytes = await composerAttachments.readImage(input.workstreamId, input.attachment.id);
			imagePreviewsStore.settleBytes(key, read, bytes);
		} catch (error) {
			imagePreviewsStore.settleUnavailable(key, read, errorMessage(error, NO_PREVIEW));
		}
	})();
}
