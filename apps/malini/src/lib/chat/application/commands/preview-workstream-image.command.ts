import { errorMessage } from '$lib/chat/domain/error-message';
import { imagePreviewKey, type WorkstreamImage } from '$lib/chat/domain/image-preview';
import { workstreamFiles } from '$lib/chat/infrastructure/services/workstream-files.service';
import { imagePreviewsStore } from '$lib/chat/infrastructure/stores/image-previews.store.svelte';

export { previewWorkstreamImageCommand };

function previewWorkstreamImageCommand(input: WorkstreamImage): void {
	const key = imagePreviewKey(input.owner, input.path);
	const read = imagePreviewsStore.begin(key, input);
	if (read === null) return;
	void (async () => {
		try {
			const bytes = await workstreamFiles.readImage(input.workstreamId, input.path);
			imagePreviewsStore.settleBytes(key, read, bytes, 'Too large to preview here');
		} catch (error) {
			imagePreviewsStore.settleUnavailable(
				key,
				read,
				errorMessage(error, 'This file is no longer readable'),
			);
		}
	})();
}
