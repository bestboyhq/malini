export type AgentComposerFileAttachment = Readonly<{
	id: string;
	displayName: string;
	relativePath: string;
	mediaType: string;
	size: number;
	sha256: string;
}>;

export type StagedAgentAttachment = AgentComposerFileAttachment;

export type AdoptedAttachment =
	| Readonly<{ sourceId: string; attachment: StagedAgentAttachment }>
	| Readonly<{ sourceId: string; error: string }>;

export const MAX_COMPOSER_ATTACHMENTS = 10;

export function isImageAttachment(attachment: StagedAgentAttachment): boolean {
	return attachment.mediaType.startsWith('image/');
}

export type AttachmentViewer = 'gallery' | 'file-tab';

export function attachmentViewer(attachment: StagedAgentAttachment): AttachmentViewer | null {
	if (isImageAttachment(attachment)) return 'gallery';
	return attachment.mediaType === 'application/pdf' ? null : 'file-tab';
}

export function mergeComposerAttachments(
	current: readonly AgentComposerFileAttachment[],
	added: readonly AgentComposerFileAttachment[],
): AgentComposerFileAttachment[] {
	const byId = new Map(current.map((attachment) => [attachment.id, attachment]));
	for (const attachment of added) byId.set(attachment.id, attachment);
	return [...byId.values()].slice(0, MAX_COMPOSER_ATTACHMENTS);
}
