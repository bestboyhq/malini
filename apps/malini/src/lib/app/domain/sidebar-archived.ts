export const ARCHIVED_ROW_PX = 24;

export const ARCHIVED_HEIGHT = {
	min: 2 * ARCHIVED_ROW_PX,
	initial: 4 * ARCHIVED_ROW_PX,
	max: 480,
} as const;

export function archivedOverflows(count: number, height: number): boolean {
	return count * ARCHIVED_ROW_PX > height;
}
