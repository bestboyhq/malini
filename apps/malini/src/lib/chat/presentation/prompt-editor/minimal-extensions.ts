import { markInputRule, markPasteRule, type AnyExtension, type Mark } from '@tiptap/core';
import Bold from '@tiptap/extension-bold';
import Code from '@tiptap/extension-code';
import CodeBlock from '@tiptap/extension-code-block';
import Document from '@tiptap/extension-document';
import HardBreak from '@tiptap/extension-hard-break';
import Italic from '@tiptap/extension-italic';
import Paragraph from '@tiptap/extension-paragraph';
import { Placeholder, UndoRedo } from '@tiptap/extensions';
import Strike from '@tiptap/extension-strike';
import Text from '@tiptap/extension-text';

import { PromptChip, type PromptChipOpener } from './prompt-chip-node';
import { SensitiveMask } from './sensitive-mask';
import { StripPrivateUse } from './strip-private-use';

export type PromptEditorExtensionOptions = {
	placeholder: string;
	chipOpener?: PromptChipOpener | undefined;
};

function delimitedText(delimiter: string, rule: 'input' | 'paste'): RegExp {
	const fence = delimiter.replace(/\*/gu, '\\*');
	const char = delimiter.charAt(0);
	const text = `[^${char}\\s](?:[^${char}]*[^${char}\\s])?`;
	const outsideWord = char === '_' ? '(?![\\p{L}\\p{N}])' : '';
	const pattern = `(?:^|\\s)(${fence}(${text})${fence}${outsideWord})`;
	return rule === 'input' ? new RegExp(`${pattern}$`, 'u') : new RegExp(pattern, 'gu');
}

function withCommonMarkRules<Options, Storage>(
	mark: Mark<Options, Storage>,
	delimiters: readonly string[],
): Mark<Options, Storage> {
	return mark.extend({
		addInputRules() {
			return delimiters.map((delimiter) =>
				markInputRule({ find: delimitedText(delimiter, 'input'), type: this.type }),
			);
		},
		addPasteRules() {
			return delimiters.map((delimiter) =>
				markPasteRule({ find: delimitedText(delimiter, 'paste'), type: this.type }),
			);
		},
	});
}

export function promptEditorExtensions(options: PromptEditorExtensionOptions): AnyExtension[] {
	return [
		Document,
		Paragraph,
		Text,

		HardBreak,

		UndoRedo.configure({ depth: 100 }),

		withCommonMarkRules(Bold, ['**', '__']),
		withCommonMarkRules(Italic, ['*', '_']),
		withCommonMarkRules(Strike, ['~~']),
		Code,
		CodeBlock,

		Placeholder.configure({
			placeholder: options.placeholder,
			showOnlyWhenEditable: true,
			includeChildren: false,
		}),

		PromptChip.configure({ opener: options.chipOpener }),

		StripPrivateUse,

		SensitiveMask,
	];
}
