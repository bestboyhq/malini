import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { mount, unmount } from 'svelte';
import { Icon } from '$hyper-ui/icons';

export type SecretMark = Readonly<{ text: string; kept: boolean }>;

export const secretMarksKey = new PluginKey<readonly SecretMark[]>('secretMarks');

const KEPT_LEAD_CLASS =
	'ml-0.5 inline-flex h-5 items-center rounded-l-md border-y border-l border-chip-border bg-chip pr-1 pl-1 align-middle text-fg-tertiary';
const KEPT_CLASS =
	'mr-0.5 inline-block h-5 rounded-r-md border-y border-r border-chip-border bg-chip pr-1.5 align-middle font-mono text-2xs leading-4.5 text-fg-default';
const SHOWN_CLASS =
	'font-mono text-[0.9em] underline decoration-warning-content decoration-wavy decoration-1 underline-offset-4';
const NAME_TAIL = /[A-Za-z0-9_]/u;

const mountedLocks = new WeakMap<Node, ReturnType<typeof mount>>();

export const SecretMarks = Extension.create({
	name: 'secretMarks',

	addProseMirrorPlugins() {
		return [
			new Plugin<readonly SecretMark[]>({
				key: secretMarksKey,
				state: {
					init: () => [],
					apply: (transaction, marks) => {
						const next: unknown = transaction.getMeta(secretMarksKey);
						return Array.isArray(next) ? next : marks;
					},
				},
				props: {
					decorations: (state) => secretDecorations(state),
				},
			}),
		];
	},
});

export function lockGlyph(className: string): HTMLElement {
	const lead = document.createElement('span');
	lead.className = className;
	lead.dataset.secretLock = '';
	lead.setAttribute('aria-hidden', 'true');
	mountedLocks.set(lead, mount(Icon, { target: lead, props: { name: 'lock', size: 12 } }));
	return lead;
}

export function releaseLockGlyphs(root: Node): void {
	if (!(root instanceof Element)) return;
	for (const lock of [root, ...root.querySelectorAll('[data-secret-lock]')]) {
		const mounted = mountedLocks.get(lock);
		if (mounted) void unmount(mounted);
		mountedLocks.delete(lock);
	}
}

function secretDecorations(state: EditorState): DecorationSet {
	const marks = secretMarksKey.getState(state) ?? [];
	if (marks.length === 0) return DecorationSet.empty;
	const decorations: Decoration[] = [];
	state.doc.descendants((node, pos) => {
		if (!node.isText || !node.text) return true;
		for (const mark of marks) {
			for (const at of occurrences(node.text, mark)) {
				decorations.push(...markDecorations(pos + at, mark));
			}
		}
		return false;
	});
	return DecorationSet.create(state.doc, decorations);
}

function markDecorations(from: number, mark: SecretMark): Decoration[] {
	const to = from + mark.text.length;
	const attributes = {
		class: mark.kept ? KEPT_CLASS : SHOWN_CLASS,
		'data-secret': mark.kept ? 'kept' : 'shown',
	};
	if (!mark.kept) return [Decoration.inline(from, to, attributes)];
	return [
		Decoration.widget(from, () => lockGlyph(KEPT_LEAD_CLASS), {
			side: -1,
			ignoreSelection: true,
			key: `secret-lock:${mark.text}`,
			destroy: releaseLockGlyphs,
		}),
		Decoration.inline(from, to, attributes),
	];
}

function occurrences(text: string, mark: SecretMark): number[] {
	const found: number[] = [];
	for (let at = text.indexOf(mark.text); at !== -1; at = text.indexOf(mark.text, at + 1)) {
		const tail = text.charAt(at + mark.text.length);
		if (!mark.kept || !NAME_TAIL.test(tail)) found.push(at);
	}
	return found;
}
