export type AgentComposerFileAttachment = Readonly<{
	id: string;
	displayName: string;
	relativePath: string;
	mediaType: string;
	size: number;
	sha256: string;
}>;

export type StagedAgentAttachment = AgentComposerFileAttachment;

export const MAX_COMPOSER_ATTACHMENTS = 10;

export function mergeComposerAttachments(
	current: readonly AgentComposerFileAttachment[],
	added: readonly AgentComposerFileAttachment[],
): AgentComposerFileAttachment[] {
	const byId = new Map(current.map((attachment) => [attachment.id, attachment]));
	for (const attachment of added) byId.set(attachment.id, attachment);
	return [...byId.values()].slice(0, MAX_COMPOSER_ATTACHMENTS);
}
