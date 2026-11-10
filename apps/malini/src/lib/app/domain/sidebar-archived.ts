export const ARCHIVED_ROW_PX = 24;

export const ARCHIVED_HEIGHT = {
	min: 2 * ARCHIVED_ROW_PX,
	initial: 4 * ARCHIVED_ROW_PX,
	max: 480,
} as const;

export function archivedOverflows(count: number, height: number): boolean {
	return count * ARCHIVED_ROW_PX > height;
}

const ARCHIVED_OVERSCAN_ROWS = 8;

export type ArchivedRowWindow = Readonly<{ start: number; end: number }>;

export function archivedRowWindow(
	count: number,
	scrollTop: number,
	viewportHeight: number,
): ArchivedRowWindow {
	const first = Math.floor(scrollTop / ARCHIVED_ROW_PX) - ARCHIVED_OVERSCAN_ROWS;
	const last = Math.ceil((scrollTop + viewportHeight) / ARCHIVED_ROW_PX) + ARCHIVED_OVERSCAN_ROWS;
	const end = Math.min(count, Math.max(0, last));
	return { start: Math.min(end, Math.max(0, first)), end };
}
