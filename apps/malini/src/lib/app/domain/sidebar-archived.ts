export const ARCHIVED_ROW_PX = 24;
export const ARCHIVED_FADE_PX = 20;

export const ARCHIVED_HEIGHT = {
	min: ARCHIVED_ROW_PX + ARCHIVED_FADE_PX,
	initial: 3 * ARCHIVED_ROW_PX + ARCHIVED_FADE_PX,
	max: 480,
} as const;

export function archivedOverflows(count: number, height: number): boolean {
	return count * ARCHIVED_ROW_PX + ARCHIVED_FADE_PX > height;
}
