import { Node, mergeAttributes, type Editor } from '@tiptap/core';
import { fileIconIdFor, fileIconUrl } from '$hyper-ui/components/file-icons';
import { parseAgentIssueReferenceUrl } from '$lib/chat/domain/issue-reference';
import {
	isPromptChipKind,
	parseElementChipId,
	promptChipFallbackLabel,
	promptChipMarker,
	promptChipShowsFileIcon,
	type PromptChipKind,
	type PromptChipRef,
} from '$lib/chat/domain/prompt-chip';

export const PROMPT_CHIP_NODE_NAME = 'promptChip';

export type PromptChipAttributes = {
	kind: PromptChipKind;
	id: string;
	label: string | null;
};

const GLYPHS: Readonly<Record<PromptChipKind, string>> = {
	attachment: '▣',
	context: '◧',
	issue: '◆',
	transcript: '◍',
	element: '⌗',
};

const CHIP_CLASS =
	'prompt-chip group/chip mx-0.5 -my-0.5 inline-flex h-5 max-w-56 cursor-default select-none items-center gap-1 rounded-md border border-chip-border bg-chip pr-1.5 pl-1 align-middle text-2xs leading-none text-fg-secondary transition-[border-color,box-shadow] duration-100 hover:border-border-default hover:bg-chip-hover hover:text-fg-default';

const LEAD_CLASS =
	'prompt-chip__lead relative grid size-3.5 shrink-0 cursor-pointer place-items-center text-fg-tertiary';

const GLYPH_CLASS =
	'prompt-chip__glyph col-start-1 row-start-1 transition-opacity group-hover/chip:opacity-0';

const CROSS_CLASS =
	'prompt-chip__cross col-start-1 row-start-1 text-sm leading-none text-fg-tertiary opacity-0 transition-opacity group-hover/chip:opacity-100 group-hover/chip:text-fg-default';

const LABEL_CLASS = 'prompt-chip__label truncate';

export function promptChipLabel(attributes: {
	kind: PromptChipKind;
	id: string;
	label: string | null;
}): string {
	const explicit = attributes.label?.trim();
	if (explicit) return explicit;
	return promptChipFallbackLabel({ kind: attributes.kind, id: attributes.id });
}

function readChipAttributes(attrs: Record<string, unknown>): PromptChipAttributes {
	const kind = attrs.kind;
	const id = attrs.id;
	const label = attrs.label;
	return {
		kind: typeof kind === 'string' && isPromptChipKind(kind) ? kind : 'attachment',
		id: typeof id === 'string' ? id : '',
		label: typeof label === 'string' ? label : null,
	};
}

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		promptChip: {
			insertPromptChip: (ref: PromptChipRef & { label?: string | null }) => ReturnType;
		};
	}
}

export const PromptChip = Node.create({
	name: PROMPT_CHIP_NODE_NAME,
	group: 'inline',
	inline: true,
	atom: true,
	selectable: false,
	draggable: false,

	addAttributes() {
		return {
			kind: {
				default: 'attachment',
				parseHTML: (element) => element.getAttribute('data-chip-kind'),
				renderHTML: (attributes) => ({ 'data-chip-kind': attributes.kind }),
			},
			id: {
				default: '',
				parseHTML: (element) => element.getAttribute('data-chip-id'),
				renderHTML: (attributes) => ({ 'data-chip-id': attributes.id }),
			},
			label: {
				default: null,
				parseHTML: (element) => element.getAttribute('data-chip-label'),
				renderHTML: (attributes) =>
					attributes.label ? { 'data-chip-label': attributes.label } : {},
			},
		};
	},

	parseHTML() {
		return [{ tag: 'span[data-prompt-chip]' }];
	},

	renderHTML({ HTMLAttributes, node }) {
		const label = promptChipLabel(readChipAttributes(node.attrs));
		return ['span', mergeAttributes(HTMLAttributes, { 'data-prompt-chip': '' }), label];
	},

	renderText({ node }) {
		const { kind, id } = readChipAttributes(node.attrs);
		return promptChipMarker({ kind, id });
	},

	addCommands() {
		return {
			insertPromptChip:
				(ref) =>
				({ chain }) =>
					chain()
						.insertContent([
							{
								type: PROMPT_CHIP_NODE_NAME,
								attrs: { kind: ref.kind, id: ref.id, label: ref.label ?? null },
							},
							{ type: 'text', text: ' ' },
						])
						.run(),
		};
	},

	addNodeView() {
		return createPromptChipNodeView;
	},

	addKeyboardShortcuts() {
		return {
			Backspace: ({ editor }) => deleteAdjacentChip(editor, 'before'),
			Delete: ({ editor }) => deleteAdjacentChip(editor, 'after'),
		};
	},
});

function deleteAdjacentChip(editor: Editor, side: 'before' | 'after'): boolean {
	const { selection } = editor.state;
	if (!selection.empty) return false;
	const { $from } = selection;
	const chip = side === 'before' ? $from.nodeBefore : $from.nodeAfter;
	if (chip?.type.name !== PROMPT_CHIP_NODE_NAME) return false;
	const from = side === 'before' ? $from.pos - chip.nodeSize : $from.pos;
	editor.view.dispatch(
		editor.state.tr.delete(from, chipRemovalEnd(editor.state.doc, from, from + chip.nodeSize)),
	);
	return true;
}

type ChipDocument = {
	content: { size: number };
	textBetween(from: number, to: number, blockSeparator?: string, leafText?: string): string;
};

const LEAF_TEXT = '\uFFFC';

function chipRemovalEnd(doc: ChipDocument, from: number, to: number): number {
	const before = doc.textBetween(Math.max(0, from - 1), from, '', LEAF_TEXT);
	const after = doc.textBetween(to, Math.min(doc.content.size, to + 1));
	return (before === '' || before === ' ') && after === ' ' ? to + 1 : to;
}

export type PromptChipNodeView = {
	dom: HTMLElement;
	update(node: { type: { name: string }; attrs: Record<string, unknown> }): boolean;
	ignoreMutation(): boolean;
	stopEvent(event: Event): boolean;
	destroy(): void;
};

type PromptChipNodeViewProps = {
	node: { attrs: Record<string, unknown> };
	editor: PromptChipNodeViewEditor;
};

type PromptChipNodeViewEditor = {
	view: {
		posAtDOM(dom: HTMLElement, offset: number): number;
		dispatch(tr: unknown): void;
	};
	state: { doc: ChipDocument; tr: { delete(from: number, to: number): unknown } };
	commands: { focus(): void; setTextSelection(position: number): void };
};

export function createPromptChipNodeView({
	node,
	editor,
}: PromptChipNodeViewProps): PromptChipNodeView {
	const attributes = readChipAttributes(node.attrs);
	const label = promptChipLabel(attributes);

	const chip = document.createElement('span');

	chip.contentEditable = 'false';
	chip.className = CHIP_CLASS;
	chip.dataset.promptChip = '';

	chip.dataset.hovercardTrigger = '';
	chip.dataset.dropdownAnchor = '';
	chip.dataset.chipKind = attributes.kind;
	chip.dataset.chipId = attributes.id;
	chip.setAttribute('aria-label', `${chipKindNoun(attributes.kind)}: ${label}`);
	applyLegacyChipHooks(chip, attributes, label);

	const lead = document.createElement('button');
	lead.type = 'button';
	lead.tabIndex = -1;
	lead.className = LEAD_CLASS;
	lead.setAttribute('aria-label', `Remove ${label}`);
	lead.dataset.testid = 'chat-composer-chip-remove';

	let glyph = chipGlyph(attributes.kind, label);

	const cross = document.createElement('span');
	cross.className = CROSS_CLASS;
	cross.setAttribute('aria-hidden', 'true');
	cross.textContent = '×';

	const text = document.createElement('span');
	text.className = LABEL_CLASS;
	text.textContent = label;

	lead.append(glyph, cross);
	chip.append(lead, text);

	const onMouseDown = (event: MouseEvent) => event.preventDefault();
	const onClick = (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		removeThisChip(editor, chip);
	};
	const onChipMouseDown = (event: MouseEvent) => {
		if (event.target instanceof globalThis.Node && lead.contains(event.target)) return;
		event.preventDefault();
		placeCaretAfter(editor, chip);
	};
	lead.addEventListener('mousedown', onMouseDown);
	lead.addEventListener('click', onClick);
	chip.addEventListener('mousedown', onChipMouseDown);

	return {
		dom: chip,

		update(updated) {
			if (updated.type.name !== PROMPT_CHIP_NODE_NAME) return false;
			const next = readChipAttributes(updated.attrs);
			if (next.kind !== attributes.kind || next.id !== attributes.id) return false;
			const nextLabel = promptChipLabel(next);
			const nextGlyph = chipGlyph(next.kind, nextLabel);
			glyph.replaceWith(nextGlyph);
			glyph = nextGlyph;
			text.textContent = nextLabel;
			lead.setAttribute('aria-label', `Remove ${nextLabel}`);
			chip.setAttribute(
				'aria-label',
				next.kind === 'attachment'
					? `Attached file: ${nextLabel}`
					: `${chipKindNoun(next.kind)}: ${nextLabel}`,
			);
			return true;
		},

		ignoreMutation: () => true,

		stopEvent: (event) =>
			event.type === 'mousedown' ||
			(event.target instanceof globalThis.Node && lead.contains(event.target)),
		destroy() {
			lead.removeEventListener('mousedown', onMouseDown);
			lead.removeEventListener('click', onClick);
			chip.removeEventListener('mousedown', onChipMouseDown);
		},
	};
}

function chipGlyph(kind: PromptChipKind, label: string): HTMLElement {
	if (promptChipShowsFileIcon(kind)) {
		const icon = document.createElement('img');
		const iconId = fileIconIdFor(label);
		icon.src = fileIconUrl(iconId);
		icon.alt = '';
		icon.draggable = false;
		icon.setAttribute('aria-hidden', 'true');
		icon.dataset.fileIcon = iconId;
		icon.className = `${GLYPH_CLASS} size-3 select-none`;
		return icon;
	}
	const glyph = document.createElement('span');
	glyph.className = GLYPH_CLASS;
	glyph.setAttribute('aria-hidden', 'true');
	glyph.textContent = GLYPHS[kind];
	return glyph;
}

function applyLegacyChipHooks(
	chip: HTMLElement,
	attributes: PromptChipAttributes,
	label: string,
): void {
	switch (attributes.kind) {
		case 'attachment':
			chip.dataset.testid = 'chat-composer-inline-attachment';
			chip.dataset.inlineAttachment = attributes.id;
			chip.setAttribute('aria-label', `Attached file: ${label}`);
			return;
		case 'context':
			chip.dataset.testid = 'chat-context-chip';
			chip.dataset.contextPath = attributes.id;
			return;
		case 'issue':
			chip.dataset.testid = 'chat-issue-reference-chip';
			chip.dataset.issueUrl = attributes.id;
			chip.dataset.issueProvider = issueProviderForUrl(attributes.id);
			return;
		case 'transcript':
			chip.dataset.testid = 'chat-transcript-reference-chip';
			chip.dataset.transcriptSessionId = attributes.id;
			return;
		case 'element': {
			chip.dataset.testid = 'chat-element-reference-chip';
			const parsed = parseElementChipId(attributes.id);
			if (!parsed) return;
			chip.dataset.elementUrl = parsed.url;
			chip.dataset.elementDomPath = parsed.domPath;
			return;
		}
	}
}

function issueProviderForUrl(url: string): string {
	return parseAgentIssueReferenceUrl(url)?.provider ?? 'unknown';
}

function chipKindNoun(kind: PromptChipKind): string {
	switch (kind) {
		case 'attachment':
			return 'Attached file';
		case 'context':
			return 'Workstream file';
		case 'issue':
			return 'Issue';
		case 'transcript':
			return 'Transcript';
		case 'element':
			return 'Page element';
	}
}

function placeCaretAfter(editor: PromptChipNodeViewEditor, dom: HTMLElement): void {
	const pos = editor.view.posAtDOM(dom, 0);
	if (pos < 0) return;
	editor.commands.setTextSelection(pos + 1);
	editor.commands.focus();
}

function removeThisChip(editor: PromptChipNodeViewEditor, dom: HTMLElement): void {
	const pos = editor.view.posAtDOM(dom, 0);
	if (pos < 0) return;
	editor.view.dispatch(editor.state.tr.delete(pos, chipRemovalEnd(editor.state.doc, pos, pos + 1)));
	editor.commands.focus();
}
