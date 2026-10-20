import { getSchema, type AnyExtension } from '@tiptap/core';
import Blockquote from '@tiptap/extension-blockquote';
import Bold from '@tiptap/extension-bold';
import Code from '@tiptap/extension-code';
import CodeBlock from '@tiptap/extension-code-block';
import Document from '@tiptap/extension-document';
import HardBreak from '@tiptap/extension-hard-break';
import Heading from '@tiptap/extension-heading';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import Italic from '@tiptap/extension-italic';
import { BulletList, ListItem, ListKeymap, OrderedList } from '@tiptap/extension-list';
import Paragraph from '@tiptap/extension-paragraph';
import Strike from '@tiptap/extension-strike';
import Text from '@tiptap/extension-text';
import { Dropcursor, Gapcursor, TrailingNode, UndoRedo } from '@tiptap/extensions';
import type { Schema } from '@tiptap/pm/model';

export function scratchpadExtensions(): AnyExtension[] {
	return [
		Document,
		Paragraph,
		Text,
		HardBreak,
		Heading.configure({ levels: [1, 2, 3] }),
		BulletList,
		OrderedList,
		ListItem,
		ListKeymap,
		Blockquote,
		CodeBlock,
		HorizontalRule,
		Bold,
		Italic,
		Strike,
		Code,
		UndoRedo.configure({ depth: 200 }),
		Dropcursor,
		Gapcursor,
		TrailingNode,
	];
}

export const scratchpadSchema: Schema = getSchema(scratchpadExtensions());
