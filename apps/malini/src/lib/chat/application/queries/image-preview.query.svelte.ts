import { imagePreviewKey, type ImagePreview } from '$lib/chat/domain/image-preview';
import { imagePreviewsStore } from '$lib/chat/infrastructure/stores/image-previews.store.svelte';

export { imagePreviewQuery };

class ImagePreviewQuery {
	public readonly data: (owner: string, subject: string) => ImagePreview | null = $derived(
		(owner: string, subject: string) =>
			imagePreviewsStore.previews[imagePreviewKey(owner, subject)] ?? null,
	);

	public readonly owned: (owner: string) => Readonly<Record<string, ImagePreview>> = $derived(
		(owner: string) => {
			const prefix = imagePreviewKey(owner, '');
			return Object.fromEntries(
				Object.entries(imagePreviewsStore.previews)
					.filter(([key]) => key.startsWith(prefix))
					.map(([key, preview]) => [key.slice(prefix.length), preview]),
			);
		},
	);
}

const imagePreviewQuery = new ImagePreviewQuery();
