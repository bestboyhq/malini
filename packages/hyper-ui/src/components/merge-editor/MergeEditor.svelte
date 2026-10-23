<script lang="ts">
	import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
	import { acceptChunk, getChunks, rejectChunk, unifiedMergeView } from '@codemirror/merge';
	import { EditorState } from '@codemirror/state';
	import { EditorView, keymap } from '@codemirror/view';
	import { onMount } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import Button from '../button/Button.svelte';
	import { mergeEditorTheme } from './merge-editor-theme';

	interface Props {
		original: string;
		value: string;
		label: string;
		class?: ClassValue;
	}

	let { original, value = $bindable(), label, class: className }: Props = $props();

	let host: HTMLDivElement | null = $state(null);
	let view: EditorView | null = null;
	let changes = $state(0);

	onMount(() => {
		if (!host) return;
		const editor = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: value,
				extensions: [
					history(),
					keymap.of([...defaultKeymap, ...historyKeymap]),
					EditorView.lineWrapping,
					mergeEditorTheme,
					EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'true' }),
					unifiedMergeView({
						original,
						mergeControls: chunkButton,
						syntaxHighlightDeletions: false,
					}),
					EditorView.updateListener.of((update) => {
						changes = chunkCount(update.state);
						if (update.docChanged) value = update.state.doc.toString();
					}),
				],
			}),
		});
		view = editor;
		changes = chunkCount(editor.state);
		return () => editor.destroy();
	});

	function chunkCount(state: EditorState): number {
		return getChunks(state)?.chunks.length ?? 0;
	}

	function chunkButton(
		kind: 'accept' | 'reject',
		action: (event: MouseEvent) => void,
	): HTMLElement {
		const button = document.createElement('button');
		button.type = 'button';
		button.textContent = kind === 'accept' ? 'Accept' : 'Reject';
		button.setAttribute('aria-label', kind === 'accept' ? 'Accept change' : 'Reject change');
		button.className =
			kind === 'accept'
				? 'btn-small btn-secondary'
				: 'btn-small text-fg-secondary hover:bg-surface-150-hover hover:text-fg-default bg-transparent';
		button.addEventListener('click', action);
		return button;
	}

	function resolveAll(resolve: typeof acceptChunk): void {
		const editor = view;
		if (!editor) return;
		const chunks = getChunks(editor.state)?.chunks ?? [];
		for (const chunk of [...chunks].reverse()) resolve(editor, chunk.fromB);
	}
</script>

<div class={['grid gap-1.5', className]}>
	<div class="flex min-h-6 items-center gap-1">
		<span class="text-fg-secondary text-sm font-medium">{label}</span>
		<span class="text-fg-tertiary text-2xs ml-1 tabular-nums" aria-live="polite">
			{changes === 0 ? 'No changes left' : changes === 1 ? '1 change' : `${changes} changes`}
		</span>
		{#if changes > 0}
			<Button
				variant="ghost"
				size="2xs"
				class="ml-auto text-xs"
				onclick={() => resolveAll(rejectChunk)}
			>
				Reject all
			</Button>
			<Button
				variant="secondary"
				size="2xs"
				class="text-xs"
				onclick={() => resolveAll(acceptChunk)}
			>
				Accept all
			</Button>
		{/if}
	</div>
	<div
		bind:this={host}
		class="border-surface-input-border bg-surface-input max-h-96 overflow-auto rounded-md border"
	></div>
</div>
