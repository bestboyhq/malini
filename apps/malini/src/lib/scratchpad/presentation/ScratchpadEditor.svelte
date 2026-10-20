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
	import { readScratchpadDocument } from './scratchpad-editor/scratchpad-document';
	import { scratchpadExtensions } from './scratchpad-editor/scratchpad-extensions';
	import {
		noteAt,
		scratchpadNotes,
		type ScratchpadNote,
	} from './scratchpad-editor/scratchpad-notes';

	interface Props {
		content: string | null;
		label: string;
		onchange: (content: string) => void;
		onstart: (start: ScratchpadStart) => void;
	}

	type GutterRow = ScratchpadNote & Readonly<{ top: number; height: number; lineHeight: number }>;

	const PLACEHOLDER = 'Jot down an idea. Command Return turns it into a workstream.';
	const START_LABEL = 'Move into a new workstream';
	const HOVER_SLACK_PX = 12;

	let { content, label, onchange, onstart }: Props = $props();

	const opened = readScratchpadDocument(untrack(() => content));

	let surface: HTMLDivElement | null = $state(null);
	let host: HTMLDivElement | null = $state(null);
	let rows = $state.raw<readonly GutterRow[]>([]);
	let hoveredPos = $state<number | null>(null);
	let empty = $state(false);
	let editor: Editor | null = null;
	let resizeObserver: ResizeObserver | null = null;

	onMount(() => {
		if (!host || opened.kind === 'unreadable') return;
		editor = new Editor({
			element: host,
			extensions: scratchpadExtensions(),
			content: opened.json,
			autofocus: opened.json === null ? 'end' : false,
			editorProps: {
				attributes: {
					class: 'scratchpad-editor text-fg-default outline-none select-text',
					role: 'textbox',
					'aria-multiline': 'true',
					'aria-label': label,
					'aria-placeholder': PLACEHOLDER,
					'data-testid': 'scratchpad-editor',
				},
				handleKeyDown: (view, event) => isStartShortcut(event) && startAtCaret(view),
			},
			onCreate: ({ editor: created }) => (empty = created.isEmpty),
			onUpdate: ({ editor: updated }) => {
				empty = updated.isEmpty;
				onchange(JSON.stringify(updated.getJSON()));
			},
			onTransaction: ({ transaction }) => {
				if (transaction.docChanged) measure();
			},
		});
		resizeObserver = new ResizeObserver(measure);
		resizeObserver.observe(editor.view.dom);
		measure();
	});

	onDestroy(() => {
		resizeObserver?.disconnect();
		editor?.destroy();
		editor = null;
	});

	function start(pos: number): void {
		if (!editor) return;
		const note = noteAt(editor.state.doc.resolve(pos + 1));
		if (!note || note.prompt.length === 0) return;
		onstart({ prompt: note.prompt, onStarted: () => cut(note) });
	}

	function cut(note: ScratchpadNote): void {
		editor?.view.dispatch(editor.state.tr.delete(note.from, note.to));
	}

	function startAtCaret(view: EditorView): boolean {
		const note = noteAt(caret(view));
		if (!note) return false;
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
			Jot down an idea. <EnterShortcut mod size={15} /> turns it into a workstream.
		</p>
	{/if}
	<div bind:this={host} class="scratchpad-host"></div>
	<div class="absolute inset-y-0 -left-9 w-9">
		{#each rows as row (row.pos)}
			{#if row.pos === hoveredPos && row.prompt.length > 0}
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
	.scratchpad-hint {
		color: var(--color-fg-placeholder);
		font-size: var(--text-base);
		line-height: 1.7;
	}

	.scratchpad-host :global(.scratchpad-editor) {
		font-size: var(--text-base);
		line-height: 1.7;
		min-height: 40vh;
		overflow-wrap: anywhere;
		padding-bottom: 30vh;
		white-space: pre-wrap;
	}

	.scratchpad-host :global(.scratchpad-editor > * + *) {
		margin-top: 0.5rem;
	}

	.scratchpad-host :global(.scratchpad-editor h1),
	.scratchpad-host :global(.scratchpad-editor h2),
	.scratchpad-host :global(.scratchpad-editor h3) {
		font-weight: 600;
		letter-spacing: -0.01em;
		line-height: 1.3;
	}

	.scratchpad-host :global(.scratchpad-editor h1) {
		font-size: 1.6em;
		margin-top: 1.6rem;
	}

	.scratchpad-host :global(.scratchpad-editor h2) {
		font-size: 1.3em;
		margin-top: 1.4rem;
	}

	.scratchpad-host :global(.scratchpad-editor h3) {
		font-size: 1.1em;
		margin-top: 1.2rem;
	}

	.scratchpad-host :global(.scratchpad-editor > :first-child) {
		margin-top: 0;
	}

	.scratchpad-host :global(.scratchpad-editor ul),
	.scratchpad-host :global(.scratchpad-editor ol) {
		padding-left: 1.5em;
	}

	.scratchpad-host :global(.scratchpad-editor ul) {
		list-style: disc;
	}

	.scratchpad-host :global(.scratchpad-editor ol) {
		list-style: decimal;
	}

	.scratchpad-host :global(.scratchpad-editor li + li),
	.scratchpad-host :global(.scratchpad-editor li > * + *) {
		margin-top: 0.25rem;
	}

	.scratchpad-host :global(.scratchpad-editor li::marker) {
		color: var(--color-fg-tertiary);
	}

	.scratchpad-host :global(.scratchpad-editor blockquote) {
		border-left: 2px solid var(--color-surface-100-border);
		color: var(--color-fg-secondary);
		padding-left: 0.875em;
	}

	.scratchpad-host :global(.scratchpad-editor hr) {
		border: 0;
		border-top: 1px solid var(--color-surface-100-border);
		margin: 1.25rem 0;
	}

	.scratchpad-host :global(.scratchpad-editor hr.ProseMirror-selectednode) {
		border-top-color: var(--color-fg-tertiary);
	}

	.scratchpad-host :global(.scratchpad-editor strong) {
		font-weight: 600;
	}

	.scratchpad-host :global(.scratchpad-editor code) {
		background: var(--color-surface-100);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: 0.875em;
		padding: 0.1em 0.35em;
	}

	.scratchpad-host :global(.scratchpad-editor pre) {
		background: var(--color-surface-50);
		border-radius: var(--radius-md);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		line-height: var(--leading-code);
		overflow-x: auto;
		padding: 0.625rem 0.75rem;
		white-space: pre;
	}

	.scratchpad-host :global(.scratchpad-editor pre code) {
		background: none;
		font-size: inherit;
		padding: 0;
	}

	.scratchpad-host :global(.ProseMirror-gapcursor::after) {
		border-top-color: var(--color-fg-default);
	}
</style>
