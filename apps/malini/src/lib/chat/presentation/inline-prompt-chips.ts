import type { StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
import {
	elementReferenceKey,
	elementReferenceLabel,
	type AgentElementReference,
} from '$lib/chat/domain/element-reference';
import type { AgentIssueReference } from '$lib/chat/domain/issue-reference';
import type { AgentTranscriptReference } from '$lib/chat/domain/transcript-reference';
import {
	parseElementChipId,
	promptChipFallbackLabel,
	promptChipRefs,
	type PromptChipKind,
	type PromptChipRef,
} from '$lib/chat/domain/prompt-chip';

export type InlinePromptReferences = {
	attachments?: readonly StagedAgentAttachment[];
	issueReferences?: readonly AgentIssueReference[];
	transcriptReferences?: readonly AgentTranscriptReference[];
	elementReferences?: readonly AgentElementReference[];
};

const GLYPHS: Readonly<Record<PromptChipKind, string>> = {
	attachment: '▣',
	context: '◧',
	issue: '◆',
	transcript: '◍',
	element: '⌗',
};

const NOUNS: Readonly<Record<PromptChipKind, string>> = {
	attachment: 'Attached file',
	context: 'Workstream file',
	issue: 'Issue',
	transcript: 'Transcript',
	element: 'Page element',
};

export const INLINE_PROMPT_CHIP_TEST_IDS: Readonly<Record<PromptChipKind, string>> = {
	attachment: 'chat-message-attachment-chip',
	context: 'chat-message-context-file-chip',
	issue: 'chat-message-issue-reference-chip',
	transcript: 'chat-message-transcript-reference-chip',
	element: 'chat-message-element-reference-chip',
};

function oneLine(value: string): string {
	return value.replace(/[\r\n]+/gu, ' ');
}

type ChipDescription = { label: string; attributes: Record<string, string> };

function describeChip(ref: PromptChipRef, references: InlinePromptReferences): ChipDescription {
	switch (ref.kind) {
		case 'attachment': {
			const attachment = references.attachments?.find((candidate) => candidate.id === ref.id);
			return {
				label: attachment?.displayName ?? promptChipFallbackLabel(ref),
				attributes: { 'data-attachment-id': ref.id },
			};
		}
		case 'context':
			return {
				label: promptChipFallbackLabel(ref),
				attributes: { 'data-context-path': ref.id },
			};
		case 'issue': {
			const reference = references.issueReferences?.find((candidate) => candidate.url === ref.id);
			return {
				label: reference?.identifier ?? promptChipFallbackLabel(ref),
				attributes: {
					'data-issue-url': ref.id,
					...(reference ? { 'data-issue-provider': reference.provider } : {}),
				},
			};
		}
		case 'transcript': {
			const reference = references.transcriptReferences?.find(
				(candidate) => candidate.sessionId === ref.id,
			);
			return {
				label: reference?.label ?? promptChipFallbackLabel(ref),
				attributes: { 'data-transcript-session-id': ref.id },
			};
		}
		case 'element': {
			const parsed = parseElementChipId(ref.id);
			const reference = references.elementReferences?.find(
				(candidate) => elementReferenceKey(candidate) === ref.id,
			);
			return {
				label: reference ? elementReferenceLabel(reference) : promptChipFallbackLabel(ref),
				attributes: parsed
					? { 'data-element-url': parsed.url, 'data-element-dom-path': parsed.domPath }
					: {},
			};
		}
	}
}

export type InlinePromptChipView = Readonly<{
	kind: PromptChipKind;
	glyph: string;
	label: string;
	ariaLabel: string;
	testId: string;
	attributes: Readonly<Record<string, string>>;
}>;

export function describeInlinePromptChip(
	ref: PromptChipRef,
	references: InlinePromptReferences = {},
): InlinePromptChipView {
	const { label, attributes } = describeChip(ref, references);
	const flatLabel = oneLine(label);
	return {
		kind: ref.kind,
		glyph: GLYPHS[ref.kind],
		label: flatLabel,
		ariaLabel: `${NOUNS[ref.kind]}: ${flatLabel}`,
		testId: INLINE_PROMPT_CHIP_TEST_IDS[ref.kind],
		attributes,
	};
}

export function promptChipRefKey(ref: PromptChipRef): string {
	return `${ref.kind} ${ref.id}`;
}

export function inlinePromptChipKeys(text: string): ReadonlySet<string> {
	return new Set(promptChipRefs(text).map(promptChipRefKey));
}

export function referencesOutsidePrompt<T>(
	text: string,
	kind: PromptChipKind,
	items: readonly T[],
	chipId: (item: T) => string,
): readonly T[] {
	if (items.length === 0) return items;
	const inline = inlinePromptChipKeys(text);
	return items.filter((item) => !inline.has(promptChipRefKey({ kind, id: chipId(item) })));
}
