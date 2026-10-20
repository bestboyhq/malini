import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

const PRIVATE_USE = /[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu;

export function containsPrivateUse(text: string): boolean {
	PRIVATE_USE.lastIndex = 0;
	return PRIVATE_USE.test(text);
}

export function privateUseRanges(text: string): { from: number; to: number }[] {
	const ranges: { from: number; to: number }[] = [];
	PRIVATE_USE.lastIndex = 0;
	let match = PRIVATE_USE.exec(text);
	while (match) {
		ranges.push({ from: match.index, to: match.index + match[0].length });
		match = PRIVATE_USE.exec(text);
	}
	return ranges;
}

export const StripPrivateUse = Extension.create({
	name: 'stripPrivateUse',

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: new PluginKey('stripPrivateUse'),
				appendTransaction: (transactions, _oldState, newState) => {
					if (!transactions.some((transaction) => transaction.docChanged)) return null;

					const ranges: { from: number; to: number }[] = [];
					newState.doc.descendants((node, pos) => {
						if (!node.isText || !node.text) return true;
						for (const range of privateUseRanges(node.text)) {
							ranges.push({ from: pos + range.from, to: pos + range.to });
						}
						return true;
					});
					if (ranges.length === 0) return null;

					const transaction = newState.tr;
					for (const range of ranges.reverse()) {
						transaction.delete(range.from, range.to);
					}
					return transaction.setMeta('addToHistory', false);
				},
			}),
		];
	},
});
