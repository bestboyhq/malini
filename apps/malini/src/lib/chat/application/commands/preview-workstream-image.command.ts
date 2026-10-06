import { errorMessage } from '$lib/chat/domain/error-message';
import { imagePreviewKey } from '$lib/chat/domain/image-preview';
import { workstreamFiles } from '$lib/chat/infrastructure/services/workstream-files.service';
import { imagePreviewsStore } from '$lib/chat/infrastructure/stores/image-previews.store.svelte';

export { previewWorkstreamImageCommand };

function previewWorkstreamImageCommand(
	input: Readonly<{ owner: string; workstreamId: string; path: string }>,
): void {
	const key = imagePreviewKey(input.owner, input.path);
	if (!imagePreviewsStore.begin(key)) return;
	void (async () => {
		try {
			const bytes = await workstreamFiles.readImage(input.workstreamId, input.path);
			imagePreviewsStore.settleBytes(key, bytes, 'Too large to preview here');
		} catch (error) {
			imagePreviewsStore.settleUnavailable(
				key,
				errorMessage(error, 'This file is no longer readable'),
			);
		}
	})();
}
