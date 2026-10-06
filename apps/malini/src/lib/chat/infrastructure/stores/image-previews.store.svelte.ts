import type { ImageBytes } from '$lib/chat/domain/image-bytes';
import { imagePreviewOwner, type ImagePreview } from '$lib/chat/domain/image-preview';

class ImagePreviewsStore {
	previews: Record<string, ImagePreview> = $state({});
	readonly #pending = new Set<string>();

	begin(key: string): boolean {
		if (this.#pending.has(key) || key in this.previews) return false;
		this.#pending.add(key);
		return true;
	}

	settleBytes(key: string, bytes: ImageBytes | null, unavailableReason: string): void {
		if (!this.#pending.delete(key)) return;
		this.#commit(
			key,
			bytes
				? { status: 'ready', src: objectUrl(bytes) }
				: { status: 'unavailable', reason: unavailableReason },
		);
	}

	settleUnavailable(key: string, reason: string): void {
		if (!this.#pending.delete(key)) return;
		this.#commit(key, { status: 'unavailable', reason });
	}

	release(owner: string): void {
		for (const key of [...this.#pending]) {
			if (imagePreviewOwner(key) === owner) this.#pending.delete(key);
		}
		const kept: Record<string, ImagePreview> = {};
		let released = false;
		for (const [key, preview] of Object.entries(this.previews)) {
			if (imagePreviewOwner(key) !== owner) {
				kept[key] = preview;
				continue;
			}
			revoke(preview);
			released = true;
		}
		if (released) this.previews = kept;
	}

	#commit(key: string, preview: ImagePreview): void {
		this.previews = { ...this.previews, [key]: preview };
	}
}

function objectUrl(bytes: ImageBytes): string {
	const binary = atob(bytes.base64);
	const buffer = new ArrayBuffer(binary.length);
	const view = new Uint8Array(buffer);
	for (let index = 0; index < binary.length; index += 1) {
		view[index] = binary.charCodeAt(index);
	}
	return URL.createObjectURL(new Blob([buffer], { type: bytes.mediaType }));
}

function revoke(preview: ImagePreview): void {
	if (preview.status === 'ready') URL.revokeObjectURL(preview.src);
}

export const imagePreviewsStore = new ImagePreviewsStore();
