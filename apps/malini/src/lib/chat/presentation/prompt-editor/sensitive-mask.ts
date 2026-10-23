import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { sensitiveSegmentsAcross } from '$hyper-ui/components/sensitive';

export const sensitiveMaskKey = new PluginKey<boolean>('sensitiveMask');

export const SensitiveMask = Extension.create({
	name: 'sensitiveMask',

	addProseMirrorPlugins() {
		return [
			new Plugin<boolean>({
				key: sensitiveMaskKey,
				state: {
					init: () => false,
					apply: (transaction, masked) => {
						const next: unknown = transaction.getMeta(sensitiveMaskKey);
						return typeof next === 'boolean' ? next : masked;
					},
				},
				props: {
					decorations: (state) =>
						sensitiveMaskKey.getState(state) ? maskDecorations(state) : DecorationSet.empty,
				},
			}),
		];
	},
});

type TextRun = { texts: string[]; positions: number[] };

function maskDecorations(state: EditorState): DecorationSet {
	const decorations: Decoration[] = [];
	state.doc.descendants((node, pos) => {
		if (!node.isTextblock) return true;
		for (const run of textRuns(node, pos + 1)) decorations.push(...runDecorations(run));
		return false;
	});
	return DecorationSet.create(state.doc, decorations);
}

function textRuns(block: ProseMirrorNode, start: number): TextRun[] {
	const runs: TextRun[] = [];
	let current: TextRun = { texts: [], positions: [] };
	block.forEach((child, offset) => {
		if (child.isText && child.text) {
			current.texts.push(child.text);
			current.positions.push(start + offset);
			return;
		}
		if (current.texts.length > 0) runs.push(current);
		current = { texts: [], positions: [] };
	});
	if (current.texts.length > 0) runs.push(current);
	return runs;
}

function runDecorations({ texts, positions }: TextRun): Decoration[] {
	return sensitiveSegmentsAcross(texts).flatMap((segments, index) => {
		let from = positions[index] ?? 0;
		return segments.flatMap((segment) => {
			const at = from;
			from += segment.text.length;
			if (!segment.kind) return [];
			return [
				Decoration.inline(at, at + segment.text.length, { class: 'hyper-sensitive-hidden' }),
				Decoration.widget(at, () => maskElement(segment.masked), {
					side: -1,
					ignoreSelection: true,
					key: `${at}:${segment.masked}`,
				}),
			];
		});
	});
}

function maskElement(masked: string): HTMLSpanElement {
	const mask = document.createElement('span');
	mask.className = 'hyper-sensitive-mask';
	mask.textContent = masked;
	return mask;
}
