import type { JSONContent } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Transform } from '@tiptap/pm/transform';
import { describe, expect, it } from 'vitest';
import { isBlankScratchpad, readScratchpadDocument } from './scratchpad-document';
import { scratchpadSchema } from './scratchpad-extensions';
import { scratchpadNotes } from './scratchpad-notes';

function open(content: JSONContent[]): ProseMirrorNode {
	return scratchpadSchema.nodeFromJSON({ type: 'doc', content });
}

function paragraph(text: string): JSONContent {
	return { type: 'paragraph', content: [{ type: 'text', text }] };
}

function list(type: 'bulletList' | 'orderedList', items: JSONContent[][]): JSONContent {
	return { type, content: items.map((content) => ({ type: 'listItem', content })) };
}

function prompts(doc: ProseMirrorNode): string[] {
	return scratchpadNotes(doc).map(({ prompt }) => prompt);
}

function cut(doc: ProseMirrorNode, prompt: string): ProseMirrorNode {
	const note = scratchpadNotes(doc).find((candidate) => candidate.prompt === prompt);
	if (!note) throw new Error(`no note reads ${prompt}`);
	return new Transform(doc).delete(note.from, note.to).doc;
}

function blocks(doc: ProseMirrorNode): string[] {
	return doc.content.content.map((block) => block.type.name);
}

describe('scratchpad notes', () => {
	it('reads paragraphs and list items, with sub-items, and skips headings and code', () => {
		const doc = open([
			{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Ideas' }] },
			{
				type: 'paragraph',
				content: [
					{ type: 'text', text: 'First line' },
					{ type: 'hardBreak' },
					{ type: 'text', text: 'second line' },
				],
			},
			list('bulletList', [
				[
					paragraph('Ship the scratchpad'),
					list('orderedList', [[paragraph('cut on start')], [paragraph('keep undo')]]),
				],
			]),
			{ type: 'codeBlock', content: [{ type: 'text', text: 'pnpm check' }] },
		]);

		expect(prompts(doc)).toEqual([
			'First line\nsecond line',
			'Ship the scratchpad\n1. cut on start\n2. keep undo',
			'cut on start',
			'keep undo',
		]);
	});

	it('cuts a note with the list or quote it leaves empty, and nothing around it', () => {
		const doc = open([
			paragraph('Keep me'),
			list('bulletList', [[paragraph('Only item')]]),
			list('bulletList', [[paragraph('First of two')], [paragraph('Second of two')]]),
			{ type: 'blockquote', content: [paragraph('Quoted idea')] },
			paragraph('Keep me too'),
		]);

		const withoutOnly = cut(doc, 'Only item');
		expect(blocks(withoutOnly)).toEqual(['paragraph', 'bulletList', 'blockquote', 'paragraph']);
		const withoutFirst = cut(withoutOnly, 'First of two');
		expect(blocks(withoutFirst)).toEqual(['paragraph', 'bulletList', 'blockquote', 'paragraph']);
		expect(prompts(withoutFirst)).toEqual([
			'Keep me',
			'Second of two',
			'Quoted idea',
			'Keep me too',
		]);
		const withoutQuote = cut(withoutFirst, 'Quoted idea');
		expect(blocks(withoutQuote)).toEqual(['paragraph', 'bulletList', 'paragraph']);
		expect(prompts(withoutQuote)).toEqual(['Keep me', 'Second of two', 'Keep me too']);
	});

	it('opens a saved scratchpad, an empty one, and refuses one it cannot read', () => {
		const saved = JSON.stringify({ type: 'doc', content: [paragraph('Saved idea')] });

		expect(readScratchpadDocument(saved)).toMatchObject({
			kind: 'readable',
			json: { content: [{ content: [{ text: 'Saved idea' }] }] },
		});
		expect(readScratchpadDocument(null)).toEqual({ kind: 'readable', json: null });
		expect(
			readScratchpadDocument(JSON.stringify({ type: 'doc', content: [{ type: 'kanban' }] })),
		).toEqual({ kind: 'unreadable' });
	});

	it('is blank only while it holds one empty paragraph, not an empty list, heading or quote', () => {
		expect(isBlankScratchpad(open([{ type: 'paragraph' }]))).toBe(true);
		expect(isBlankScratchpad(open([list('bulletList', [[{ type: 'paragraph' }]])]))).toBe(false);
		expect(isBlankScratchpad(open([{ type: 'heading', attrs: { level: 1 } }]))).toBe(false);
		expect(
			isBlankScratchpad(open([{ type: 'blockquote', content: [{ type: 'paragraph' }] }])),
		).toBe(false);
		expect(isBlankScratchpad(open([paragraph('An idea')]))).toBe(false);
	});
});
