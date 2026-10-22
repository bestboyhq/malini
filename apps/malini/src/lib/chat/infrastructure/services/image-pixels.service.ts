import type { ImageChanges, ImagePixels } from '$lib/chat/domain/image-changes';
import { invoke } from '$shared/port/invoke';

class ImagePixelsService {
	async read(workstreamId: string, path: string): Promise<ImagePixels | null> {
		const image = await invoke('repositories.read-workstream-image', { workstreamId, path });
		if (image.status !== 'ready') return null;
		const bitmap = await createImageBitmap(
			new Blob([image.bytes.data], { type: image.bytes.mediaType }),
		);
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		const context = canvas.getContext('2d', { willReadFrequently: true });
		if (!context) return null;
		context.drawImage(bitmap, 0, 0);
		bitmap.close();
		const { width, height, data } = context.getImageData(0, 0, canvas.width, canvas.height);
		return { width, height, data };
	}

	async maskUrl(changes: ImageChanges): Promise<string> {
		const canvas = new OffscreenCanvas(changes.width, changes.height);
		canvas
			.getContext('2d')
			?.putImageData(
				new ImageData(new Uint8ClampedArray(changes.mask), changes.width, changes.height),
				0,
				0,
			);
		return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }));
	}
}

export const imagePixels = new ImagePixelsService();
