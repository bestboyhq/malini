import { getSchema } from '@tiptap/core';
import {
	MarkdownParser,
	MarkdownSerializer,
	defaultMarkdownParser,
	defaultMarkdownSerializer,
} from 'prosemirror-markdown';
import { Fragment, type Node as PMNode, type Schema } from '@tiptap/pm/model';

import {
	isPromptChipKind,
	promptChipMarker,
	promptChipSegments,
} from '$lib/chat/domain/prompt-chip';

import { promptEditorExtensions } from './minimal-extensions';
import { PROMPT_CHIP_NODE_NAME } from './prompt-chip-node';

export const promptEditorSchema: Schema = getSchema(promptEditorExtensions({ placeholder: '' }));

const chipType = requireNodeType(PROMPT_CHIP_NODE_NAME);

function requireNodeType(name: string): NonNullable<(typeof promptEditorSchema.nodes)[string]> {
	const type = promptEditorSchema.nodes[name];
	if (!type) throw new Error(`prompt-markdown: the prompt schema has no ${name} node`);
	return type;
}

function defaultMarkSerializer(
	name: string,
): NonNullable<(typeof defaultMarkdownSerializer.marks)[string]> {
	const mark = defaultMarkdownSerializer.marks[name];
	if (!mark) throw new Error(`prompt-markdown: the default serializer has no ${name} mark`);
	return mark;
}

function defaultNodeSerializer(
	name: string,
): NonNullable<(typeof defaultMarkdownSerializer.nodes)[string]> {
	const node = defaultMarkdownSerializer.nodes[name];
	if (!node) throw new Error(`prompt-markdown: the default serializer has no ${name} node`);
	return node;
}

const serializer = new MarkdownSerializer(
	{
		doc(state, node) {
			state.renderContent(node);
		},
		paragraph: defaultNodeSerializer('paragraph'),
		text(state, node) {
			state.text(state.esc(node.text ?? '', false), false);
		},

		hardBreak(state, node, parent, index) {
			for (let next = index + 1; next < parent.childCount; next += 1) {
				if (parent.child(next).type === node.type) continue;
				state.write('\n');
				return;
			}
		},
		codeBlock(state, node) {
			const runs = node.textContent.match(/`{3,}/gmu);
			const fence = runs ? `${runs.sort().slice(-1)[0]}\`` : '```';
			state.write(fence + (node.attrs.language ?? '') + '\n');
			state.text(node.textContent, false);
			state.write('\n');
			state.write(fence);
			state.closeBlock(node);
		},

		promptChip(state, node) {
			const kind = node.attrs.kind;
			if (!isPromptChipKind(kind)) return;
			state.text(promptChipMarker({ kind, id: String(node.attrs.id) }), false);
		},
	},
	{
		bold: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
		italic: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true },

		strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },

		code: defaultMarkSerializer('code'),
	},

	{ hardBreakNodeName: 'hardBreak' },
);

type MarkdownItTokenizer = typeof defaultMarkdownParser.tokenizer;
type MarkdownItConstructor = new (
	preset: string,
	options: Record<string, unknown>,
) => MarkdownItTokenizer;

function isMarkdownItConstructor(value: unknown): value is MarkdownItConstructor {
	return typeof value === 'function';
}

const MarkdownIt = defaultMarkdownParser.tokenizer.constructor;
if (!isMarkdownItConstructor(MarkdownIt)) {
	throw new Error('prompt-markdown: the default tokenizer has no constructor');
}

const tokenizer = new MarkdownIt('commonmark', { html: false })
	.enable(['strikethrough'])
	.disable([
		'heading',
		'lheading',
		'list',
		'blockquote',
		'hr',
		'table',
		'reference',
		'link',
		'image',
		'autolink',
	]);

const parser = new MarkdownParser(promptEditorSchema, tokenizer, {
	paragraph: { block: 'paragraph' },
	code_block: { block: 'codeBlock', noCloseToken: true },
	fence: {
		block: 'codeBlock',
		getAttrs: (token) => ({ language: token.info.trim() || null }),
		noCloseToken: true,
	},
	hardbreak: { node: 'hardBreak' },
	softbreak: { node: 'hardBreak' },
	em: { mark: 'italic' },
	strong: { mark: 'bold' },
	s: { mark: 'strike' },
	code_inline: { mark: 'code', noCloseToken: true },
});

export function promptDocToMarkdown(doc: PMNode): string {
	return serializer.serialize(doc);
}

export function markdownToPromptDoc(markdown: string): PMNode {
	return replaceChipMarkers(parser.parse(markdown));
}

export function replaceChipMarkers(doc: PMNode): PMNode {
	return rewriteNode(doc);
}

function rewriteNode(node: PMNode): PMNode {
	if (node.isLeaf || node.isAtom || node.type.spec.code) return node;
	return node.copy(rewriteFragment(node.content));
}

function rewriteFragment(fragment: Fragment): Fragment {
	const children: PMNode[] = [];

	fragment.forEach((child) => {
		if (!child.isText) {
			children.push(rewriteNode(child));
			return;
		}

		const segments = promptChipSegments(child.text ?? '');
		if (!segments.some((segment) => segment.kind === 'chip')) {
			children.push(child);
			return;
		}

		for (const segment of segments) {
			if (segment.kind === 'text') {
				children.push(promptEditorSchema.text(segment.text, child.marks));
				continue;
			}

			children.push(
				chipType.create(
					{ kind: segment.ref.kind, id: segment.ref.id, label: null },
					null,
					child.marks,
				),
			);
		}
	});

	return Fragment.fromArray(children);
}
