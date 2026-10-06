import type { StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
import type { AgentElementReference } from '$lib/chat/domain/element-reference';
import type { AgentIssueReference } from '$lib/chat/domain/issue-reference';
import { elementReferenceKey } from '$lib/chat/domain/element-reference';
import { referencesOutsidePrompt } from '../inline-prompt-chips';

export function attachmentsOutsidePrompt(
	text: string,
	attachments: readonly StagedAgentAttachment[],
): readonly StagedAgentAttachment[] {
	return referencesOutsidePrompt(text, 'attachment', attachments, (item) => item.id);
}

export function contextFilesOutsidePrompt(
	text: string,
	paths: readonly string[],
): readonly string[] {
	return referencesOutsidePrompt(text, 'context', paths, (path) => path);
}

export function issueReferencesOutsidePrompt(
	text: string,
	references: readonly AgentIssueReference[],
): readonly AgentIssueReference[] {
	return referencesOutsidePrompt(text, 'issue', references, (item) => item.url);
}

export function elementReferencesOutsidePrompt(
	text: string,
	references: readonly AgentElementReference[],
): readonly AgentElementReference[] {
	return referencesOutsidePrompt(text, 'element', references, elementReferenceKey);
}
