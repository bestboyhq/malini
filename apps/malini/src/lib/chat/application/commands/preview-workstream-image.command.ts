import type { WorkstreamImageRead } from '$contract/repositories';
import { errorMessage } from '$lib/chat/domain/error-message';
import { imagePreviewKey, type WorkstreamImage } from '$lib/chat/domain/image-preview';
import { workstreamFiles } from '$lib/chat/infrastructure/services/workstream-files.service';
import { imagePreviewsStore } from '$lib/chat/infrastructure/stores/image-previews.store.svelte';

export { previewWorkstreamImageCommand };

const UNAVAILABLE_REASONS: Readonly<
	Record<Exclude<WorkstreamImageRead['status'], 'ready'>, string>
> = {
	missing: 'This file no longer exists',
	'too-large': 'Too large to preview here',
	'not-an-image': 'No preview for this file type',
};

function previewWorkstreamImageCommand(input: WorkstreamImage): void {
	const key = imagePreviewKey(input.owner, input.path);
	const read = imagePreviewsStore.begin(key, input);
	if (read === null) return;
	void (async () => {
		try {
			const image = await workstreamFiles.readImage(input.workstreamId, input.path);
			if (image.status === 'ready') imagePreviewsStore.settleBytes(key, read, image.bytes);
			else imagePreviewsStore.settleUnavailable(key, read, UNAVAILABLE_REASONS[image.status]);
		} catch (error) {
			imagePreviewsStore.settleUnavailable(
				key,
				read,
				errorMessage(error, 'This file is no longer readable'),
			);
		}
	})();
}
