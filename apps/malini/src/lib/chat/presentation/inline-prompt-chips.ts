import {
	attachmentViewer,
	isVideoAttachment,
	type StagedAgentAttachment,
} from '$lib/chat/domain/composer-actions';
import type { AgentDraft } from '$lib/chat/domain/draft';
import {
	elementReferenceKey,
	elementReferenceLabel,
	type AgentElementReference,
} from '$lib/chat/domain/element-reference';
import type { AgentTranscriptReference } from '$lib/chat/domain/transcript-reference';
import {
	parseElementChipId,
	promptChipFallbackLabel,
	promptChipRefs,
	type PromptChipKind,
	type PromptChipRef,
} from '$lib/chat/domain/prompt-chip';
import { galleryImageLabel } from './workstream-images';

export type InlinePromptReferences = {
	attachments?: readonly StagedAgentAttachment[];
	transcriptReferences?: readonly AgentTranscriptReference[];
	elementReferences?: readonly AgentElementReference[];
};

const GLYPHS: Readonly<Record<PromptChipKind, string>> = {
	attachment: '▣',
	context: '◧',
	transcript: '◍',
	element: '⌗',
};

const NOUNS: Readonly<Record<PromptChipKind, string>> = {
	attachment: 'Attached file',
	context: 'Workstream file',
	transcript: 'Transcript',
	element: 'Page element',
};

export const INLINE_PROMPT_CHIP_TEST_IDS: Readonly<Record<PromptChipKind, string>> = {
	attachment: 'chat-message-attachment-chip',
	context: 'chat-message-context-file-chip',
	transcript: 'chat-message-transcript-reference-chip',
	element: 'chat-message-element-reference-chip',
};

export const CHIP_CLASS =
	'border-chip-border bg-chip/50 text-2xs text-fg-secondary inline-flex h-6 max-w-56 min-w-0 items-center gap-1 rounded-md border px-1.5';

export const OPENABLE_CHIP_CLASS =
	'hover:bg-chip-hover focus-visible:ring-button-primary/40 cursor-zoom-in focus-visible:ring-2 focus-visible:outline-none';

export type ChipOpener = Readonly<{ label: string; open: () => void }>;

export function attachmentOpener(
	attachment: StagedAgentAttachment,
	onopen: ((attachment: StagedAgentAttachment) => void) | undefined,
): ChipOpener | undefined {
	const viewer = attachmentViewer(attachment);
	if (!onopen || viewer === null) return undefined;
	const label =
		viewer === 'gallery'
			? galleryImageLabel(attachment.displayName, isVideoAttachment(attachment) ? 'video' : 'image')
			: `Open file ${attachment.displayName}`;
	return { label, open: () => onopen(attachment) };
}

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

export function draftChipDescriptors(
	draft: Omit<AgentDraft, 'text'>,
): (PromptChipRef & { label: string })[] {
	return [
		...draft.attachments.map((attachment) => ({
			kind: 'attachment' as const,
			id: attachment.id,
			label: attachment.displayName,
		})),
		...draft.contextFiles.map((path) => ({
			kind: 'context' as const,
			id: path,
			label: promptChipFallbackLabel({ kind: 'context', id: path }),
		})),
		...draft.transcriptReferences.map((reference) => ({
			kind: 'transcript' as const,
			id: reference.sessionId,
			label: reference.label,
		})),
		...draft.elementReferences.map((reference) => ({
			kind: 'element' as const,
			id: elementReferenceKey(reference),
			label: elementReferenceLabel(reference),
		})),
	];
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
