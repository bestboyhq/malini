import { describe, expect, it } from 'vitest';
import { scratchpadIdeas } from './scratchpad-document';

function doc(content: unknown[]): string {
	return JSON.stringify({ type: 'doc', content });
}

function text(value: string): unknown[] {
	return [{ type: 'text', text: value }];
}

function heading(value: string): unknown {
	return { type: 'heading', attrs: { level: 2 }, content: text(value) };
}

function paragraph(value?: string): unknown {
	return value === undefined ? { type: 'paragraph' } : { type: 'paragraph', content: text(value) };
}

describe('scratchpadIdeas', () => {
	it('makes a heading and the text under it one idea', () => {
		expect(
			scratchpadIdeas(
				doc([
					heading('[ ] distinctive queue counts'),
					paragraph(),
					heading('Zombies drill tractor'),
					paragraph('A tractor digs and zombies climb out'),
					paragraph('Round 50 floods the map'),
					paragraph(),
				]),
			),
		).toEqual([
			{ title: '[ ] distinctive queue counts', detail: '' },
			{ title: 'Zombies drill tractor', detail: 'A tractor digs and zombies climb out' },
		]);
	});

	it('makes every block before the first heading its own idea', () => {
		expect(
			scratchpadIdeas(
				doc([
					paragraph('Try a co-op mode'),
					{
						type: 'bulletList',
						content: [
							{ type: 'listItem', content: [paragraph('Shared seeds')] },
							{ type: 'listItem', content: [paragraph('Split screen')] },
						],
					},
					heading('Later'),
				]),
			),
		).toEqual([
			{ title: 'Try a co-op mode', detail: '' },
			{ title: 'Shared seeds', detail: 'Split screen' },
			{ title: 'Later', detail: '' },
		]);
	});

	it('finds no ideas in a missing, blank, or unreadable scratchpad', () => {
		expect(scratchpadIdeas(null)).toEqual([]);
		expect(scratchpadIdeas(doc([paragraph(), heading('   ')]))).toEqual([]);
		expect(scratchpadIdeas(doc([{ type: 'nope' }]))).toEqual([]);
		expect(scratchpadIdeas('not json')).toEqual([]);
	});
});
