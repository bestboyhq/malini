import { describe, expect, it } from 'vitest';
import { DECK_ADD_WIDTH, DECK_GAP, deckColumnWidth } from './browser-deck';

describe('browser deck columns', () => {
	it('shares the width between the columns and Add column while every column gets 360px', () => {
		expect(deckColumnWidth(1_000, 1)).toBe(1_000 - DECK_ADD_WIDTH - DECK_GAP);
		expect(deckColumnWidth(1_000, 2)).toBe(Math.floor((1_000 - DECK_ADD_WIDTH - 2 * DECK_GAP) / 2));
	});

	it('sizes the columns so the last ones and Add column fill the width once they no longer all fit', () => {
		for (const [width, columns] of [
			[1_000, 3],
			[1_500, 5],
			[547, 4],
			[300, 4],
		] as const) {
			const column = deckColumnWidth(width, columns);
			const shown = Math.floor((width - DECK_ADD_WIDTH) / (column + DECK_GAP)) || 1;
			expect(shown).toBeLessThan(columns);
			expect(width - DECK_ADD_WIDTH - shown * (column + DECK_GAP)).toBeGreaterThanOrEqual(0);
			expect(width - DECK_ADD_WIDTH - shown * (column + DECK_GAP)).toBeLessThan(shown);
		}
		expect(deckColumnWidth(1_000, 3)).toBe(Math.floor((1_000 - DECK_ADD_WIDTH - 2 * DECK_GAP) / 2));
		expect(deckColumnWidth(300, 4)).toBe(300 - DECK_ADD_WIDTH - DECK_GAP);
	});
});
