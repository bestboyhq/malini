<script lang="ts">
	import { Editor } from '@tiptap/core';
	import type { ResolvedPos } from '@tiptap/pm/model';
	import type { EditorView } from '@tiptap/pm/view';
	import { onDestroy, onMount, untrack } from 'svelte';
	import { EnterShortcut } from '$hyper-ui/components/enter-shortcut';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import type { ScratchpadStart } from '$lib/scratchpad/domain/scratchpad';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import {
		isBlankScratchpad,
		readScratchpadDocument,
	} from './scratchpad-editor/scratchpad-document';
	import { scratchpadExtensions } from './scratchpad-editor/scratchpad-extensions';
	import {
		noteAt,
		scratchpadNotes,
		type ScratchpadNote,
	} from './scratchpad-editor/scratchpad-notes';

	interface Props {
		content: string | null;
		label: string;
		placeholder?: string;
		onchange: (content: string, blank: boolean) => void;
		onstart: ((start: ScratchpadStart) => void) | null;
	}

	type GutterRow = ScratchpadNote & Readonly<{ top: number; height: number; lineHeight: number }>;

	const PLACEHOLDER = 'Jot down an idea. Command Return turns it into a workstream.';
	const START_LABEL = 'Move into a new workstream';
	const HOVER_SLACK_PX = 12;

	let { content, label, placeholder, onchange, onstart }: Props = $props();

	const opened = readScratchpadDocument(untrack(() => content));

	let surface: HTMLDivElement | null = $state(null);
	let host: HTMLDivElement | null = $state(null);
	let rows = $state.raw<readonly GutterRow[]>([]);
	let hoveredPos = $state<number | null>(null);
	let empty = $state(false);
	let editor: Editor | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let shown = untrack(() => content);

	onMount(() => {
		if (!host || opened.kind === 'unreadable') return;
		editor = new Editor({
			element: host,
			extensions: scratchpadExtensions(),
			content: opened.json,
			autofocus: opened.json === null && untrack(() => onstart) !== null ? 'end' : false,
			editorProps: {
				attributes: {
					class: 'scratchpad-editor text-fg-default outline-none select-text',
					role: 'textbox',
					'aria-multiline': 'true',
					'aria-label': label,
					'aria-placeholder': untrack(() => placeholder) ?? PLACEHOLDER,
					'data-testid': 'scratchpad-editor',
				},
				handleKeyDown: (view, event) => isStartShortcut(event) && startAtCaret(view),
			},
			onCreate: ({ editor: created }) => (empty = isBlankScratchpad(created.state.doc)),
			onUpdate: ({ editor: updated }) => {
				empty = isBlankScratchpad(updated.state.doc);
				shown = JSON.stringify(updated.getJSON());
				onchange(shown, empty);
			},
			onTransaction: ({ transaction }) => {
				if (transaction.docChanged) measure();
			},
		});
		resizeObserver = new ResizeObserver(measure);
		resizeObserver.observe(editor.view.dom);
		measure();
	});

	$effect(() => {
		const next = content;
		if (!editor || editor.isFocused || next === shown || (next === null && empty)) return;
		const changed = readScratchpadDocument(next);
		if (changed.kind === 'unreadable') return;
		shown = next;
		editor.commands.setContent(changed.json ?? '', { emitUpdate: false });
		empty = isBlankScratchpad(editor.state.doc);
	});

	onDestroy(() => {
		resizeObserver?.disconnect();
		editor?.destroy();
		editor = null;
	});

	function start(pos: number): void {
		if (!editor || !onstart) return;
		const note = noteAt(editor.state.doc.resolve(pos + 1));
		if (!note || note.prompt.length === 0) return;
		onstart({ prompt: note.prompt, onStarted: () => cut(note) });
	}

	function cut(note: ScratchpadNote): void {
		editor?.view.dispatch(editor.state.tr.delete(note.from, note.to));
	}

	function startAtCaret(view: EditorView): boolean {
		const note = noteAt(caret(view));
		if (!note || !onstart) return false;
		start(note.pos);
		return true;
	}

	function caret(view: EditorView): ResolvedPos {
		const selection = view.dom.ownerDocument.getSelection();
		const anchor = selection?.anchorNode;
		if (!selection || !anchor || !view.dom.contains(anchor)) return view.state.selection.$from;
		return view.state.doc.resolve(view.posAtDOM(anchor, selection.anchorOffset));
	}

	function isStartShortcut(event: KeyboardEvent): boolean {
		return (
			event.key === 'Enter' &&
			(event.metaKey || event.ctrlKey) &&
			!event.shiftKey &&
			!event.altKey &&
			!event.isComposing
		);
	}

	function measure(): void {
		if (!editor || !surface) return;
		const view = editor.view;
		const origin = surface.getBoundingClientRect();
		rows = scratchpadNotes(editor.state.doc).flatMap((note) => {
			const element = view.nodeDOM(note.pos);
			if (!(element instanceof HTMLElement)) return [];
			const box = element.getBoundingClientRect();
			const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
			return [
				{
					...note,
					top: box.top - origin.top,
					height: box.height,
					lineHeight: Number.isFinite(lineHeight) ? lineHeight : box.height,
				},
			];
		});
	}

	function onPointerMove(event: PointerEvent): void {
		if (!surface) return;
		const y = event.clientY - surface.getBoundingClientRect().top;
		hoveredPos = null;
		for (const row of rows) {
			if (row.top > y) break;
			if (y < row.top + row.height + HOVER_SLACK_PX) hoveredPos = row.pos;
		}
	}
</script>

{#if opened.kind === 'unreadable'}
	<StateBlock
		layout="inline"
		live="alert"
		tone="critical"
		heading="This scratchpad could not be read"
		detail="It was saved in a shape this version of Malini does not know, so it stays untouched."
		remedy="Update Malini, then open it again."
		testId="scratchpad-unreadable"
	>
		{#snippet icon()}
			<Icon name="alert" size={14} />
		{/snippet}
	</StateBlock>
{/if}

<div
	bind:this={surface}
	class={['relative', opened.kind === 'unreadable' && 'hidden']}
	role="presentation"
	onpointermove={onPointerMove}
	onpointerleave={() => (hoveredPos = null)}
>
	{#if empty}
		<p class="scratchpad-hint pointer-events-none absolute inset-x-0 top-0" aria-hidden="true">
			{#if placeholder}
				{placeholder}
			{:else}
				Jot down an idea. <EnterShortcut mod size={14} /> turns it into a workstream.
			{/if}
		</p>
	{/if}
	<div bind:this={host} class="scratchpad-host"></div>
	<div class="absolute inset-y-0 -left-9 w-9">
		{#each rows as row (row.pos)}
			{#if onstart && row.pos === hoveredPos && row.prompt.length > 0}
				<div
					class="absolute left-0 flex w-7 items-center justify-center"
					style:top={`${row.top}px`}
					style:height={`${row.lineHeight}px`}
				>
					<Tooltip content={startHint} placement="left">
						<IconButton
							variant="ghost"
							size="sm"
							ariaLabel={START_LABEL}
							ariaKeyshortcuts="Meta+Enter"
							data-testid="scratchpad-start-workstream"
							onclick={() => start(row.pos)}
						>
							<Icon name="send" size={14} />
						</IconButton>
					</Tooltip>
				</div>
			{/if}
		{/each}
	</div>
</div>

{#snippet startHint()}
	{START_LABEL} · <EnterShortcut mod />
{/snippet}

<style>
	.scratchpad-hint,
	.scratchpad-host :global(.scratchpad-editor) {
		font-family: 'Inter Variable', var(--font-sans);
		font-optical-sizing: auto;
		font-size: var(--text-sm);
		line-height: 1.5rem;
		text-rendering: optimizeLegibility;
		-webkit-font-smoothing: antialiased;
	}

	.scratchpad-hint {
		color: var(--color-fg-placeholder);
	}

	.scratchpad-host :global(.scratchpad-editor) {
		--scratchpad-well: color-mix(in srgb, var(--color-surface-100) 50%, var(--color-surface-50));
		color: var(--color-fg-default);
		min-height: 40vh;
		overflow-wrap: anywhere;
		padding-bottom: 30vh;
		white-space: pre-wrap;
	}

	.scratchpad-host :global(.scratchpad-editor > :first-child) {
		margin-top: 0;
	}

	.scratchpad-host :global(.scratchpad-editor p) {
		margin: 0 0 1.375rem;
	}

	.scratchpad-host :global(.scratchpad-editor :is(h1, h2, h3)) {
		color: var(--color-fg-agent-message-strong);
		font-weight: 550;
		line-height: 1.5rem;
	}

	.scratchpad-host :global(.scratchpad-editor h1) {
		font-size: 1.0625rem;
		font-weight: 600;
		letter-spacing: -0.011em;
		margin: 3rem 0 1.125rem;
	}

	.scratchpad-host :global(.scratchpad-editor h2) {
		font-size: 0.9375rem;
		letter-spacing: -0.006em;
		margin: 3rem 0 1.125rem;
	}

	.scratchpad-host :global(.scratchpad-editor h3) {
		font-size: inherit;
		margin: 2rem 0 0.625rem;
	}

	.scratchpad-host :global(.scratchpad-editor :is(ul, ol)) {
		margin: 0 0 1.375rem;
		padding-left: 2rem;
	}

	.scratchpad-host :global(.scratchpad-editor ul) {
		list-style: disc;
		padding-left: 1.3125rem;
	}

	.scratchpad-host :global(.scratchpad-editor ol) {
		list-style: decimal;
	}

	.scratchpad-host :global(.scratchpad-editor li) {
		margin-bottom: 0.4375rem;
		padding-left: 2px;
	}

	.scratchpad-host :global(.scratchpad-editor li > p) {
		margin: 0;
	}

	.scratchpad-host :global(.scratchpad-editor li::marker) {
		color: var(--color-fg-agent-message-strong);
		font-weight: 600;
	}

	.scratchpad-host :global(.scratchpad-editor ol > li::marker) {
		font-size: 0.82em;
	}

	.scratchpad-host :global(.scratchpad-editor ul > li::marker) {
		color: var(--color-fg-tertiary);
	}

	.scratchpad-host :global(.scratchpad-editor li > :is(ul, ol)) {
		margin-top: 0.4375rem;
	}

	.scratchpad-host :global(.scratchpad-editor li > :is(ul, ol, pre, blockquote):last-child) {
		margin-bottom: 0;
	}

	.scratchpad-host :global(.scratchpad-editor blockquote) {
		color: var(--color-fg-secondary);
		font-family: 'STIX Two Text Variable', ui-serif, Georgia, serif;
		font-size: 1.24em;
		font-style: italic;
		line-height: 1.875rem;
		margin: 0 0 1.625rem;
		padding: 0.5rem 0 0.5rem 1.125rem;
		position: relative;
	}

	.scratchpad-host :global(.scratchpad-editor blockquote::before) {
		background: var(--color-surface-invert);
		border-radius: 999px;
		bottom: 0.3125rem;
		content: '';
		left: 0;
		position: absolute;
		top: 0.3125rem;
		width: 3px;
	}

	.scratchpad-host :global(.scratchpad-editor blockquote p) {
		margin: 0;
	}

	.scratchpad-host :global(.scratchpad-editor blockquote p + p) {
		margin-top: 0.625rem;
	}

	.scratchpad-host :global(.scratchpad-editor blockquote em) {
		font-family: inherit;
		font-size: inherit;
	}

	.scratchpad-host :global(.scratchpad-editor hr) {
		border: 0;
		border-top: 1px solid var(--color-border-default);
		margin: 2.25rem 0;
	}

	.scratchpad-host :global(.scratchpad-editor hr.ProseMirror-selectednode) {
		border-top-color: var(--color-fg-tertiary);
	}

	.scratchpad-host :global(.scratchpad-editor strong) {
		font-weight: 600;
	}

	.scratchpad-host :global(.scratchpad-editor em) {
		font-family: Georgia, 'Times New Roman', serif;
		font-size: 0.98em;
		font-style: italic;
	}

	.scratchpad-host :global(.scratchpad-editor :not(pre) > code) {
		background: var(--scratchpad-well);
		border: 1px solid var(--color-border-default);
		border-radius: 3px;
		font-family: var(--font-mono);
		font-size: 0.86em;
		line-height: 1;
		padding: 1px 6px;
	}

	.scratchpad-host :global(.scratchpad-editor pre) {
		background: var(--scratchpad-well);
		border-radius: 0.5rem;
		box-shadow: inset 0 0 0 0.5px var(--color-border-default);
		font-family: var(--font-mono);
		font-size: 0.75rem;
		font-variant-ligatures: none;
		line-height: 1.25rem;
		margin: 0 0 1.375rem;
		overflow-x: auto;
		padding: 0.875rem 1rem;
		white-space: pre;
	}

	.scratchpad-host :global(.scratchpad-editor pre code) {
		font: inherit;
	}

	.scratchpad-host :global(.ProseMirror-gapcursor::after) {
		border-top-color: var(--color-fg-default);
	}
</style>
