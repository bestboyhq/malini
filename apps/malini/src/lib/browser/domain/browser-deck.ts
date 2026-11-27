export const DECK_GAP = 8;
export const DECK_ADD_WIDTH = 120;
const MIN_COLUMN = 360;

export function deckColumnWidth(width: number, columns: number): number {
	if (width <= 0 || columns <= 0) return MIN_COLUMN;
	const room = width - DECK_ADD_WIDTH;
	const shown = Math.min(columns, Math.max(1, Math.floor(room / (MIN_COLUMN + DECK_GAP))));
	return Math.max(1, Math.floor((room - DECK_GAP * shown) / shown));
}
