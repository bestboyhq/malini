import { imagePreviewKey, type ImagePreview } from '$lib/chat/domain/image-preview';
import { imagePreviewsStore } from '$lib/chat/infrastructure/stores/image-previews.store.svelte';

export { imagePreviewQuery };

class ImagePreviewQuery {
	public readonly data: (owner: string, subject: string) => ImagePreview | null = $derived(
		(owner: string, subject: string) =>
			imagePreviewsStore.previews[imagePreviewKey(owner, subject)] ?? null,
	);
}

const imagePreviewQuery = new ImagePreviewQuery();
