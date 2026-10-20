import type { ImageBytes } from '$lib/chat/domain/image-bytes';
import {
	imagePreviewKey,
	imagePreviewOwner,
	type ImagePreview,
	type WorkstreamImage,
} from '$lib/chat/domain/image-preview';

class ImagePreviewsStore {
	previews: Record<string, ImagePreview> = $state({});
	readonly #reads = new Map<string, number>();
	readonly #workstreamImages = new Map<string, WorkstreamImage>();
	readonly #stale = new Set<string>();
	readonly #versions = new Map<string, number>();
	#lastRead = 0;

	begin(key: string, image?: WorkstreamImage): number | null {
		const stale = this.#stale.delete(key);
		if (!stale && (this.#reads.has(key) || key in this.previews)) return null;
		if (image) this.#workstreamImages.set(key, image);
		const read = ++this.#lastRead;
		this.#reads.set(key, read);
		return read;
	}

	retry(key: string): number {
		const read = ++this.#lastRead;
		this.#reads.set(key, read);
		return read;
	}

	imageVersion(workstreamId: string, path: string): number {
		return this.#versions.get(imagePreviewKey(workstreamId, path)) ?? 0;
	}

	markStale(workstreamId: string, changed: (path: string) => boolean): readonly WorkstreamImage[] {
		const stale: WorkstreamImage[] = [];
		const bumped = new Set<string>();
		for (const [key, image] of this.#workstreamImages) {
			if (image.workstreamId !== workstreamId || !changed(image.path)) continue;
			this.#stale.add(key);
			stale.push(image);
			bumped.add(imagePreviewKey(workstreamId, image.path));
		}
		for (const image of bumped) this.#versions.set(image, (this.#versions.get(image) ?? 0) + 1);
		return stale;
	}

	settleUrl(key: string, read: number, src: string): void {
		if (!this.#finish(key, read)) return;
		this.#commit(key, { status: 'ready', src });
	}

	settleBytes(key: string, read: number, bytes: ImageBytes): void {
		if (!this.#finish(key, read)) return;
		this.#commit(key, { status: 'ready', src: objectUrl(bytes) });
	}

	settleUnavailable(key: string, read: number, reason: string): void {
		if (!this.#finish(key, read)) return;
		this.#commit(key, { status: 'unavailable', reason });
	}

	release(owner: string): void {
		const owned = (key: string): boolean => imagePreviewOwner(key) === owner;
		for (const key of [...this.#reads.keys()].filter(owned)) this.#reads.delete(key);
		for (const key of [...this.#workstreamImages.keys()].filter(owned)) {
			this.#workstreamImages.delete(key);
			this.#stale.delete(key);
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

	#finish(key: string, read: number): boolean {
		if (this.#reads.get(key) !== read) return false;
		this.#reads.delete(key);
		return true;
	}

	#commit(key: string, preview: ImagePreview): void {
		const replaced = this.previews[key];
		this.previews = { ...this.previews, [key]: preview };
		if (replaced) revoke(replaced);
	}
}

function objectUrl(bytes: ImageBytes): string {
	return URL.createObjectURL(new Blob([bytes.data], { type: bytes.mediaType }));
}

function revoke(preview: ImagePreview): void {
	if (preview.status === 'ready' && preview.src.startsWith('blob:'))
		URL.revokeObjectURL(preview.src);
}

export const imagePreviewsStore = new ImagePreviewsStore();
