import { EditorView } from '@codemirror/view';

const added = (percent: number): string =>
	`color-mix(in srgb, var(--code-added) ${percent}%, transparent)`;
const removed = (percent: number): string =>
	`color-mix(in srgb, var(--code-removed) ${percent}%, transparent)`;

export const mergeEditorTheme = EditorView.theme({
	'&': {
		fontFamily: 'var(--font-mono)',
		fontSize: 'var(--text-2xs)',
		color: 'var(--color-fg-default)',
		backgroundColor: 'transparent',
	},
	'&.cm-focused': { outline: 'none' },
	'.cm-content': { padding: '0.375rem 0', caretColor: 'var(--color-fg-default)' },
	'.cm-line': { padding: '0 0.625rem', lineHeight: '1.25rem' },
	'.cm-gutters': { border: 'none', backgroundColor: 'transparent' },
	'.cm-changeGutter': { width: '2px', paddingLeft: '0' },
	'&.cm-merge-b .cm-changedLine': { backgroundColor: added(12) },
	'&.cm-merge-b .cm-changedText': { background: added(32) },
	'&.cm-merge-b .cm-changedLineGutter': { background: 'var(--code-added)' },
	'.cm-deletedLineGutter': { background: 'var(--code-removed)' },
	'.cm-deletedChunk': { paddingLeft: '0', backgroundColor: 'transparent' },
	'.cm-deletedChunk .cm-deletedLine': {
		padding: '0 0.625rem',
		lineHeight: '1.25rem',
		color: 'var(--color-fg-secondary)',
		backgroundColor: removed(12),
	},
	'.cm-deletedChunk .cm-deletedText': { background: removed(32) },
	'.cm-deletedChunk .cm-chunkButtons': {
		position: 'static',
		display: 'flex',
		flexDirection: 'row-reverse',
		gap: '0.375rem',
		padding: '0.375rem 0.625rem 0.25rem',
		fontFamily: 'var(--font-sans)',
	},
});
