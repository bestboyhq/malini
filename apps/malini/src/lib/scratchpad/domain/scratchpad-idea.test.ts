import { describe, expect, it } from 'vitest';
import { isScratchpadContent } from './scratchpad';
import { appendScratchpadIdea } from './scratchpad-idea';

function text(value: string): unknown[] {
	return [{ type: 'text', text: value }];
}

function appended(content: unknown, idea: string): unknown {
	const result = appendScratchpadIdea(content === null ? null : JSON.stringify(content), idea);
	expect(result !== null && isScratchpadContent(result)).toBe(true);
	return JSON.parse(result ?? 'null');
}

describe('appendScratchpadIdea', () => {
	it('starts an empty scratchpad with the idea', () => {
		expect(appended(null, '  Add a dark mode  ')).toEqual({
			type: 'doc',
			content: [{ type: 'paragraph', content: text('Add a dark mode') }],
		});
	});

	it('adds the idea after the last block of an existing scratchpad', () => {
		expect(
			appended(
				{
					type: 'doc',
					content: [{ type: 'paragraph', content: text('Old') }, { type: 'paragraph' }],
				},
				'First line\nSecond line',
			),
		).toEqual({
			type: 'doc',
			content: [
				{ type: 'paragraph', content: text('Old') },
				{
					type: 'paragraph',
					content: [...text('First line'), { type: 'hardBreak' }, ...text('Second line')],
				},
			],
		});
	});

	it('adds the idea as a heading when the scratchpad is split into headed ideas', () => {
		const heading = { type: 'heading', attrs: { level: 2 }, content: text('Old') };
		expect(appended({ type: 'doc', content: [heading] }, 'New')).toEqual({
			type: 'doc',
			content: [heading, { type: 'heading', attrs: { level: 2 }, content: text('New') }],
		});
	});

	it('refuses an unreadable scratchpad or a blank idea', () => {
		expect(appendScratchpadIdea('not json', 'New')).toBeNull();
		expect(appendScratchpadIdea('{"type":"doc","content":{}}', 'New')).toBeNull();
		expect(appendScratchpadIdea(null, ' \n ')).toBeNull();
	});
});
