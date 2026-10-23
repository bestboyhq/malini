import { describe, expect, it } from 'vitest';
import type { GroupedRunTimelineItem } from '../activity-group';
import { estimateRowHeight } from './transcript-estimates';

const reply: GroupedRunTimelineItem = {
	kind: 'assistant',
	key: 'reply',
	seq: 1,
	text: 'word '.repeat(200).trim(),
};

describe('estimateRowHeight', () => {
	it('wraps a reply into lines as wide as the column', () => {
		expect(estimateRowHeight(reply, 776)).toBe(10 * 22.75);
		expect(estimateRowHeight(reply, 388)).toBe(19 * 22.75);
	});

	it('spaces paragraphs by the paragraph gap', () => {
		const paragraphs = { ...reply, text: 'First paragraph.\n\nSecond paragraph.' };
		expect(estimateRowHeight(paragraphs, 776)).toBe(22.75 + 12.25 + 22.75);
	});

	it('assumes the full column before the column is measured', () => {
		expect(estimateRowHeight(reply, 0)).toBe(estimateRowHeight(reply, 776));
	});
});
