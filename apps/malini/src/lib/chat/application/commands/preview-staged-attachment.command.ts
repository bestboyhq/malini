import { isImageAttachment, type StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
import { errorMessage } from '$lib/chat/domain/error-message';
import { imagePreviewKey } from '$lib/chat/domain/image-preview';
import { composerAttachments } from '$lib/chat/infrastructure/services/composer-attachments.service';
import { imagePreviewsStore } from '$lib/chat/infrastructure/stores/image-previews.store.svelte';

export { previewStagedAttachmentCommand };

function previewStagedAttachmentCommand(
	input: Readonly<{ owner: string; workstreamId: string; attachment: StagedAgentAttachment }>,
): void {
	if (!isImageAttachment(input.attachment)) return;
	const key = imagePreviewKey(input.owner, input.attachment.id);
	if (!imagePreviewsStore.begin(key)) return;
	void (async () => {
		try {
			const bytes = await composerAttachments.readImage(input.workstreamId, input.attachment.id);
			imagePreviewsStore.settleBytes(key, bytes, 'This attachment has no preview');
		} catch (error) {
			imagePreviewsStore.settleUnavailable(
				key,
				errorMessage(error, 'This attachment has no preview'),
			);
		}
	})();
}
