import { imagePreviewsStore } from '$lib/chat/infrastructure/stores/image-previews.store.svelte';

export { releaseImagePreviewsCommand };

function releaseImagePreviewsCommand(owner: string): void {
	imagePreviewsStore.release(owner);
}
