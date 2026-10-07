import { isImageAttachment } from '$lib/chat/domain/composer-actions';
import { renderSanitizedHtml } from './MarkdownText.svelte';
import type { RenderItem, RunGroup } from './render-state';
import { toolImageRead } from './tool-image-read';
import {
	holdWorkstreamImages,
	linklessImages,
	markdownImageId,
	markdownImageName,
	WORKSTREAM_IMAGE_ATTRIBUTE,
} from './workstream-images';

export type GalleryImage = Readonly<{
	id: string;
	name: string;
	kind: 'workstream' | 'url';
}>;

export function transcriptGalleryImages(runs: readonly RunGroup[]): GalleryImage[] {
	const images = new Map<string, GalleryImage>();
	for (const run of runs) {
		for (const item of run.items) {
			for (const image of itemImages(item)) {
				if (!images.has(image.id)) images.set(image.id, image);
			}
		}
	}
	return [...images.values()];
}

function itemImages(item: RenderItem): readonly GalleryImage[] {
	if (item.kind === 'user') {
		return (item.attachments ?? []).filter(isImageAttachment).map((attachment) => ({
			id: attachment.relativePath,
			name: attachment.displayName,
			kind: 'workstream',
		}));
	}
	if (item.kind === 'tool') {
		const read = toolImageRead(item.tool.name, item.tool.input, item.tool.output);
		return read?.previewable ? [{ id: read.path, name: read.fileName, kind: 'workstream' }] : [];
	}
	if (item.kind === 'assistant') return markdownImages(item.text);
	return [];
}

function markdownImages(text: string): GalleryImage[] {
	if (typeof document === 'undefined') return [];
	if (!text.includes('![') && !text.includes('<img')) return [];
	const template = document.createElement('template');
	template.innerHTML = holdWorkstreamImages(renderSanitizedHtml(text, 'prose'));
	return linklessImages(template.content).flatMap((image) => {
		const id = markdownImageId(image);
		if (id === null) return [];
		const kind = image.hasAttribute(WORKSTREAM_IMAGE_ATTRIBUTE) ? 'workstream' : 'url';
		return [{ id, name: markdownImageName(image, id), kind }];
	});
}
