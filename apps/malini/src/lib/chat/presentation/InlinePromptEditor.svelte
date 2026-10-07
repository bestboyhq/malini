<script lang="ts">
	import { Editor } from '@tiptap/core';
	import { closeHistory } from '@tiptap/pm/history';
	import { onDestroy, onMount } from 'svelte';
	import { isPromptChipKind, type PromptChipRef } from '$lib/chat/domain/prompt-chip';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { promptEditorExtensions } from './prompt-editor/minimal-extensions';
	import { PROMPT_CHIP_NODE_NAME } from './prompt-editor/prompt-chip-node';
	import type { PromptChipPreview } from './prompt-editor/prompt-chip-preview';
	import PromptChipPreviewCard from './prompt-editor/PromptChipPreviewCard.svelte';
	import { markdownToPromptDoc, promptDocToMarkdown } from './prompt-editor/prompt-markdown';
	import {
		clipboardAttachmentCandidates,
		type ClipboardAttachmentCandidate,
	} from './prompt-editor/clipboard-attachments';

	export type PromptChipDescriptor = PromptChipRef & { label: string };

	interface Props {
		value: string;
		chips: readonly PromptChipDescriptor[];
		placeholder: string;
		placeholderHidden?: boolean;
		disabled?: boolean;
		resolvePreview: (ref: PromptChipRef) => PromptChipPreview;
		onvaluechange: (value: string) => void;
		onchipremove: (ref: PromptChipRef) => void | Promise<void>;
		onattachfiles: (candidates: readonly ClipboardAttachmentCandidate[]) => void | Promise<void>;
		onkeydown: (event: KeyboardEvent) => void;
	}

	let {
		value,
		chips,
		placeholder,
		placeholderHidden = false,
		disabled = false,
		resolvePreview,
		onvaluechange,
		onchipremove,
		onattachfiles,
		onkeydown,
	}: Props = $props();

	let host: HTMLDivElement | null = $state(null);

	let editor = $state<Editor | null>(null);
	let editorFocused = $state(false);

	let knownRefKeys = new Set<string>();
	let pendingRemovalKeys = $state<Set<string>>(new Set());

	let pendingInsertPos: number | null = null;

	function refKey(ref: PromptChipRef): string {
		return `${ref.kind}\u0000${ref.id}`;
	}

	function documentRefKeys(): Set<string> {
		const keys = new Set<string>();
		if (!editor) return keys;
		editor.state.doc.descendants((node) => {
			if (node.type.name !== PROMPT_CHIP_NODE_NAME) return true;
			keys.add(refKey({ kind: node.attrs.kind, id: node.attrs.id }));
			return false;
		});
		return keys;
	}

	function currentMarkdown(): string {
		return editor ? promptDocToMarkdown(editor.state.doc) : '';
	}

	function reportRemovals(): void {
		const present = documentRefKeys();
		for (const chip of chips) {
			const key = refKey(chip);
			if (!knownRefKeys.has(key) || present.has(key) || pendingRemovalKeys.has(key)) continue;
			const ref: PromptChipRef = { kind: chip.kind, id: chip.id };
			markRemovalPending(key, true);
			void Promise.resolve(onchipremove(ref))
				.catch(() => {})
				.finally(() => {
					markRemovalPending(key, false);
					insertNewChips();
				});
		}
		knownRefKeys = present;
	}

	function markRemovalPending(key: string, pending: boolean): void {
		const next = new Set(pendingRemovalKeys);
		if (pending) next.add(key);
		else next.delete(key);
		pendingRemovalKeys = next;
	}

	function insertNewChips(): void {
		if (!editor || disabled) return;
		const present = documentRefKeys();
		const missing = chips.filter((chip) => {
			const key = refKey(chip);
			return !present.has(key) && !knownRefKeys.has(key) && !pendingRemovalKeys.has(key);
		});
		if (missing.length === 0) return;

		if (pendingInsertPos !== null) {
			editor.commands.setTextSelection(
				Math.min(Math.max(pendingInsertPos, 0), editor.state.doc.content.size),
			);
			pendingInsertPos = null;
		}

		editor.view.dispatch(closeHistory(editor.state.tr));
		for (const chip of missing) {
			const { from } = editor.state.selection;
			const before = editor.state.doc.textBetween(Math.max(0, from - 1), from, '', '');
			if (before && !/\s/u.test(before)) editor.commands.insertContent(' ');
			editor.commands.insertPromptChip({ kind: chip.kind, id: chip.id, label: chip.label });
			knownRefKeys.add(refKey(chip));
		}
		editor.view.dispatch(closeHistory(editor.state.tr));
		editor.commands.focus();
	}

	function syncLabels(): void {
		if (!editor) return;
		const byKey = new Map(chips.map((chip) => [refKey(chip), chip.label]));
		let transaction = editor.state.tr;
		let changed = false;
		editor.state.doc.descendants((node, pos) => {
			if (node.type.name !== PROMPT_CHIP_NODE_NAME) return true;
			const label = byKey.get(refKey({ kind: node.attrs.kind, id: node.attrs.id }));
			if (!label || label === node.attrs.label) return false;
			transaction = transaction.setNodeMarkup(pos, undefined, { ...node.attrs, label });
			changed = true;
			return false;
		});
		if (changed) editor.view.dispatch(transaction.setMeta('addToHistory', false));
	}

	function applyValue(next: string): void {
		if (!editor || currentMarkdown() === next) return;
		editor.commands.setContent(markdownToPromptDoc(next).toJSON(), { emitUpdate: false });
		knownRefKeys = documentRefKeys();
	}

	let previewRef = $state<PromptChipRef | null>(null);
	let previewAnchor = $state<HTMLElement | null>(null);
	let previewTimer: ReturnType<typeof setTimeout> | null = null;

	const preview = $derived(previewRef ? resolvePreview(previewRef) : null);

	function chipUnderPointer(target: EventTarget | null): HTMLElement | null {
		if (!(target instanceof Element)) return null;
		return target.closest<HTMLElement>('[data-prompt-chip]');
	}

	function openPreview(chip: HTMLElement): void {
		const kind = chip.dataset.chipKind;
		const id = chip.dataset.chipId;
		if (!kind || id === undefined || !isPromptChipKind(kind)) return;
		previewAnchor = chip;
		previewRef = { kind, id };
	}

	function closePreview(): void {
		if (previewTimer) clearTimeout(previewTimer);
		previewTimer = null;
		previewRef = null;
		previewAnchor = null;
	}

	function onPointerOver(event: PointerEvent): void {
		const chip = chipUnderPointer(event.target);
		if (!chip) return;
		if (chip === previewAnchor) return;
		if (previewTimer) clearTimeout(previewTimer);

		previewTimer = setTimeout(() => openPreview(chip), 160);
	}

	function onPointerOut(event: PointerEvent): void {
		const chip = chipUnderPointer(event.target);
		if (!chip) return;
		const next = event.relatedTarget;
		if (next instanceof Node && chip.contains(next)) return;
		closePreview();
	}

	function focusEditor(options?: { scrollIntoView?: boolean }): void {
		editor?.commands.focus(null, { scrollIntoView: options?.scrollIntoView ?? true });
	}

	function insertChip(chip: PromptChipDescriptor): void {
		if (!editor) return;
		knownRefKeys.add(refKey(chip));
		editor.commands.insertPromptChip(chip);
		editor.commands.focus();
	}

	function insertText(text: string): void {
		if (!editor) return;
		editor.commands.insertContent({ type: 'text', text });
		editor.commands.focus();
	}

	export { focusEditor, insertChip, insertText };

	onMount(() => {
		if (!host) return;
		editor = new Editor({
			element: host,
			extensions: promptEditorExtensions({ placeholder }),
			editable: !disabled,
			content: markdownToPromptDoc(value).toJSON(),
			editorProps: {
				attributes: {
					class:
						'inline-prompt-editor min-h-18 min-w-0 w-full overflow-x-hidden break-words border-0 bg-transparent p-3 pr-4 text-[15px] leading-6 text-fg-default outline-none transition-[color,border-color] select-text',
					role: 'textbox',
					'aria-multiline': 'true',
					'aria-label': 'Chat prompt',
					'aria-disabled': String(disabled),
					'data-testid': 'chat-composer-input',
				},
				handleKeyDown: (_view, event) => {
					onkeydown(event);
					return event.defaultPrevented;
				},

				handlePaste: (view, event) => {
					const candidates = clipboardAttachmentCandidates(
						event.clipboardData,
						String(chips.length),
					);
					if (candidates.length === 0) return false;
					event.preventDefault();
					pendingInsertPos = view.state.selection.from;
					void onattachfiles(candidates);
					return true;
				},
				handleDrop: (view, event, _slice, _moved) => {
					if (!(event instanceof DragEvent)) return false;
					const candidates = clipboardAttachmentCandidates(
						event.dataTransfer,
						String(chips.length),
					);
					if (candidates.length === 0) return false;
					event.preventDefault();

					pendingInsertPos =
						view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ??
						view.state.selection.from;
					void onattachfiles(candidates);
					return true;
				},
				handleTextInput: (view, from, to, text) => {
					if (/^[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]+$/u.test(text))
						return true;
					if (text.length === 1) return false;
					view.dispatch(view.state.tr.insertText(text, from, to));
					return true;
				},
			},
			onUpdate: () => {
				onvaluechange(currentMarkdown());
				reportRemovals();
			},
			onFocus: () => {
				editorFocused = true;
			},
			onBlur: () => {
				queueMicrotask(() => {
					editorFocused = editor?.isFocused ?? false;
				});
			},
		});
		knownRefKeys = documentRefKeys();

		editor.view.dom.addEventListener('pointerover', onPointerOver);
		editor.view.dom.addEventListener('pointerout', onPointerOut);
	});

	onDestroy(() => {
		if (previewTimer) clearTimeout(previewTimer);
		editor?.destroy();
		editor = null;
	});

	$effect(() => {
		void value;
		if (!editor) return;
		applyValue(value);
	});

	$effect(() => {
		void chips;
		if (!editor) return;
		syncLabels();
		insertNewChips();
	});

	$effect(() => {
		const editable = !disabled;
		if (!editor) return;

		editor.setEditable(editable, false);
		editor.view.dom.setAttribute('aria-disabled', String(!editable));
		editor.view.dom.setAttribute('tabindex', editable ? '0' : '-1');
	});
</script>

<ScrollableDiv
	class="max-h-52 w-full"
	viewportClass="max-h-52"
	orientation="y"
	testId="chat-composer-scroller"
>
	<div
		bind:this={host}
		class={[
			'prompt-editor-host w-full',
			!editorFocused && value.trim() !== '' && 'hyper-sensitive-mask',
		]}
		data-placeholder-hidden={placeholderHidden ? '' : undefined}
	></div>
</ScrollableDiv>

<DropdownLayer
	open={Boolean(preview)}
	anchor={previewAnchor}
	onclose={closePreview}
	side="top"
	align="center"
	offset={8}
	backdrop={false}
	keyboardNavigation={false}
	restoreFocusToAnchor={false}
	panelClass="pointer-events-none"
	testId="chat-composer-chip-preview-layer"
	owner="prompt-chip-preview"
>
	<PromptChipPreviewCard {preview} />
</DropdownLayer>

<style>
	.prompt-editor-host :global(.ProseMirror) {
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}

	.prompt-editor-host :global(.ProseMirror p) {
		margin: 0;
	}

	.prompt-editor-host :global(.ProseMirror p + p) {
		margin-top: 0.5rem;
	}

	.prompt-editor-host :global(.ProseMirror p.is-editor-empty:first-child::before) {
		color: var(--color-fg-placeholder);
		content: attr(data-placeholder);
		float: left;
		font-size: var(--text-sm);
		font-weight: var(--font-weight-normal);
		height: 0;
		pointer-events: none;

		transition:
			color var(--default-transition-duration),
			opacity var(--default-transition-duration);
	}

	.prompt-editor-host[data-placeholder-hidden]
		:global(.ProseMirror p.is-editor-empty:first-child::before) {
		opacity: 0;
	}

	.prompt-editor-host :global(.ProseMirror:focus p.is-editor-empty:first-child::before) {
		color: var(--color-fg-composer-placeholder-focus);
	}

	.prompt-editor-host :global(.ProseMirror [data-prompt-chip]) {
		max-width: calc(100% - 0.5rem);
	}

	.prompt-editor-host :global(.ProseMirror [data-prompt-chip].ProseMirror-selectednode) {
		background: color-mix(in oklab, var(--color-primary) 14%, var(--color-chip));
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px color-mix(in oklab, var(--color-primary) 32%, transparent);
		outline: none;
	}

	.prompt-editor-host
		:global(.ProseMirror [data-prompt-chip].ProseMirror-selectednode .prompt-chip__label) {
		color: var(--color-fg-default);
	}

	.prompt-editor-host
		:global(.ProseMirror [data-prompt-chip].ProseMirror-selectednode .prompt-chip__glyph) {
		opacity: 0;
	}

	.prompt-editor-host
		:global(.ProseMirror [data-prompt-chip].ProseMirror-selectednode .prompt-chip__cross) {
		color: var(--color-fg-default);
		opacity: 1;
	}

	.prompt-editor-host :global(.ProseMirror code) {
		background: var(--color-surface-50);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: 0.9em;
		padding: 0.1em 0.3em;
	}

	.prompt-editor-host :global(.ProseMirror pre) {
		background: var(--color-surface-50);
		border-radius: var(--radius-md);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		line-height: var(--leading-code);
		margin: 0.375rem 0;
		overflow-x: auto;
		padding: 0.5rem 0.625rem;
	}

	.prompt-editor-host :global(.ProseMirror pre code) {
		background: none;
		padding: 0;
	}
</style>
