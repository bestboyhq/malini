import { previewWorkstreamImageCommand } from '$lib/chat/application/commands/preview-workstream-image.command';
import { workstreamPathChanged } from '$lib/chat/domain/image-preview';
import { imagePreviewsStore } from '$lib/chat/infrastructure/stores/image-previews.store.svelte';

export { refreshWorkstreamImagesCommand };

function refreshWorkstreamImagesCommand(
	workstreamId: string,
	changedPaths: readonly string[] | null,
): void {
	const changed = workstreamPathChanged(changedPaths);
	for (const image of imagePreviewsStore.markStale(workstreamId, changed)) {
		previewWorkstreamImageCommand(image);
	}
}
