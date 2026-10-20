import type { AgentComposerFileAttachment } from '$lib/chat/domain/composer-actions';
import {
	sanitizeAgentElementReferences,
	type AgentElementReference,
} from '$lib/chat/domain/element-reference';
import {
	sanitizeAgentTranscriptReferences,
	type AgentTranscriptReference,
} from '$lib/chat/domain/transcript-reference';

export type ComposerSubmissionRecoverySnapshot = Readonly<{
	prompt: string;
	contextFiles: readonly string[];
	attachments: readonly AgentComposerFileAttachment[];
	transcriptReferences?: readonly AgentTranscriptReference[];
	elementReferences?: readonly AgentElementReference[];
}>;

export function mergeFailedComposerSubmissions(
	failures: readonly ComposerSubmissionRecoverySnapshot[],
	newerDraft: ComposerSubmissionRecoverySnapshot,
): ComposerSubmissionRecoverySnapshot {
	return {
		prompt: [...failures.map(({ prompt }) => prompt), newerDraft.prompt]
			.filter((prompt) => prompt.trim())
			.join('\n\n'),
		contextFiles: uniqueStrings([
			...failures.flatMap(({ contextFiles }) => contextFiles),
			...newerDraft.contextFiles,
		]),
		attachments: uniqueAttachments([
			...failures.flatMap(({ attachments }) => attachments),
			...newerDraft.attachments,
		]),
		transcriptReferences: sanitizeAgentTranscriptReferences([
			...failures.flatMap(({ transcriptReferences }) => transcriptReferences ?? []),
			...(newerDraft.transcriptReferences ?? []),
		]),
		elementReferences: sanitizeAgentElementReferences([
			...failures.flatMap(({ elementReferences }) => elementReferences ?? []),
			...(newerDraft.elementReferences ?? []),
		]),
	};
}

function uniqueStrings(values: readonly string[]): string[] {
	return [...new Set(values)];
}

function uniqueAttachments(
	values: readonly AgentComposerFileAttachment[],
): AgentComposerFileAttachment[] {
	const seen = new Set<string>();
	return values.filter((attachment) => {
		if (seen.has(attachment.id)) return false;
		seen.add(attachment.id);
		return true;
	});
}
