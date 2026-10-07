export const WORKSTREAM_IMAGE_ATTRIBUTE = 'data-workstream-image';

const NOT_WORKSTREAM_RELATIVE = /^(?:[a-z][a-z\d+.-]*:|[/#?])/iu;

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
	if (src.length === 0 || NOT_WORKSTREAM_RELATIVE.test(src)) return null;
	try {
		return decodeURI(src);
	} catch {
		return src;
	}
}
