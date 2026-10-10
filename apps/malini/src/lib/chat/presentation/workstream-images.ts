export const WORKSTREAM_IMAGE_ATTRIBUTE = 'data-workstream-image';

const NOT_A_WORKSTREAM_FILE = /^(?:[a-z][a-z\d+.-]*:|\/\/|[#?])/iu;

export function holdWorkstreamImages(sanitizedHtml: string): string {
	if (typeof document === 'undefined' || !sanitizedHtml.includes('<img')) return sanitizedHtml;

	const template = document.createElement('template');
	template.innerHTML = sanitizedHtml;
	let held = false;
	for (const image of template.content.querySelectorAll('img[src]')) {
		const path = workstreamImagePath(image.getAttribute('src') ?? '');
		if (path === null) continue;
		image.setAttribute(WORKSTREAM_IMAGE_ATTRIBUTE, path);
		image.removeAttribute('src');
		held = true;
	}
	return held ? template.innerHTML : sanitizedHtml;
}

export function showWorkstreamImages(
	root: ParentNode,
	imageSource: ((path: string) => string | null) | undefined,
): void {
	if (!imageSource) return;
	for (const image of root.querySelectorAll(`img[${WORKSTREAM_IMAGE_ATTRIBUTE}]`)) {
		const src = imageSource(image.getAttribute(WORKSTREAM_IMAGE_ATTRIBUTE) ?? '');
		if (src !== null && image.getAttribute('src') !== src) image.setAttribute('src', src);
	}
}

function workstreamImagePath(src: string): string | null {
	if (src.length === 0 || NOT_A_WORKSTREAM_FILE.test(src)) return null;
	try {
		return decodeURI(src);
	} catch {
		return src;
	}
}

export const GALLERY_IMAGE_ATTRIBUTE = 'data-gallery-image';

export function galleryImageLabel(name: string): string {
	return `Open image ${name} in gallery`;
}

export function offerGalleryImages(root: ParentNode): void {
	for (const image of linklessImages(root)) {
		const id = markdownImageId(image);
		if (id === null || image.getAttribute(GALLERY_IMAGE_ATTRIBUTE) === id) continue;
		image.setAttribute(GALLERY_IMAGE_ATTRIBUTE, id);
		image.setAttribute('role', 'button');
		image.setAttribute('tabindex', '0');
		image.setAttribute('aria-label', galleryImageLabel(markdownImageName(image, id)));
	}
}

export function linklessImages(root: ParentNode): HTMLImageElement[] {
	return [...root.querySelectorAll('img')].filter((image) => !image.closest('a'));
}

export function markdownImageId(image: Element): string | null {
	return image.getAttribute(WORKSTREAM_IMAGE_ATTRIBUTE) || image.getAttribute('src') || null;
}

export function markdownImageName(image: HTMLImageElement, id: string): string {
	const alt = image.alt.trim();
	if (alt) return alt;
	if (!image.hasAttribute(WORKSTREAM_IMAGE_ATTRIBUTE)) return 'image';
	return id.split('/').filter(Boolean).pop() ?? id;
}
