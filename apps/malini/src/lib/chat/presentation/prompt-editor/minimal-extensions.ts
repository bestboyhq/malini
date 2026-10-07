import type { AnyExtension } from '@tiptap/core';
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

import { PromptChip } from './prompt-chip-node';
import { StripPrivateUse } from './strip-private-use';

export type PromptEditorExtensionOptions = {
	placeholder: string;
};

export function promptEditorExtensions(options: PromptEditorExtensionOptions): AnyExtension[] {
	return [
		Document,
		Paragraph,
		Text,

		HardBreak,

		UndoRedo.configure({ depth: 100 }),

		Bold,
		Italic,
		Strike,
		Code,
		CodeBlock,

		Placeholder.configure({
			placeholder: options.placeholder,
			showOnlyWhenEditable: true,
			includeChildren: false,
		}),

		PromptChip,

		StripPrivateUse,
	];
}
