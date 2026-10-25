import {
	attachmentViewer,
	isVideoAttachment,
	type StagedAgentAttachment,
} from '$lib/chat/domain/composer-actions';
import { mediaKind } from '$lib/chat/domain/turn-report';
import { renderSanitizedHtml } from './MarkdownText.svelte';
import type { RenderItem, RunGroup } from './render-state';
import { toolImageRead } from './tool-image-read';
import {
	type GalleryMedia,
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
	media: GalleryMedia;
}>;

export function isGalleryAttachment(attachment: StagedAgentAttachment): boolean {
	return attachmentViewer(attachment) === 'gallery';
}

export function attachmentGalleryImage(attachment: StagedAgentAttachment): GalleryImage {
	return {
		id: attachment.relativePath,
		name: attachment.displayName,
		kind: 'workstream',
		media: isVideoAttachment(attachment) ? 'video' : 'image',
	};
}

export function transcriptGalleryImages(
	runs: readonly RunGroup[],
	workstreamId: string,
): GalleryImage[] {
	const images = new Map<string, GalleryImage>();
	for (const run of runs) {
		for (const item of run.items) {
			for (const image of itemImages(item, workstreamId)) {
				if (!images.has(image.id)) images.set(image.id, image);
			}
		}
	}
	return [...images.values()];
}

function itemImages(item: RenderItem, workstreamId: string): readonly GalleryImage[] {
	if (item.kind === 'user') {
		return (item.attachments ?? []).filter(isGalleryAttachment).map(attachmentGalleryImage);
	}
	if (item.kind === 'tool') {
		const read = toolImageRead(item.tool.name, item.tool.input, item.tool.output, workstreamId);
		return read ? [{ id: read.path, name: read.fileName, kind: 'workstream', media: 'image' }] : [];
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
		const media = id === null ? 'page' : mediaKind(id);
		if (id === null || media === 'page') return [];
		const kind = image.hasAttribute(WORKSTREAM_IMAGE_ATTRIBUTE) ? 'workstream' : 'url';
		return [{ id, name: markdownImageName(image, id), kind, media }];
	});
}
