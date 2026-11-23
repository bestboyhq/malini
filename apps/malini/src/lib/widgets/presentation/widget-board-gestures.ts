export type Point = Readonly<{ x: number; y: number }>;

export type Box = Readonly<{ left: number; top: number; width: number; height: number }>;

export const DRAG_THRESHOLD = 5;

export function slotIndex(point: Point, boxes: readonly Box[]): number {
	let nearest = Number.POSITIVE_INFINITY;
	let index = boxes.length;
	for (const [at, box] of boxes.entries()) {
		const centerX = box.left + box.width / 2;
		const distance = Math.hypot(point.x - centerX, point.y - (box.top + box.height / 2));
		if (distance >= nearest) continue;
		nearest = distance;
		index = point.x > centerX && point.y > box.top + box.height / 3 ? at + 1 : at;
	}
	return index;
}

export function withPlaceholder<T>(
	order: readonly T[],
	dragged: T | null,
	at: number | null,
): readonly (T | null)[] {
	if (at === null) return order;
	const entries: (T | null)[] = [];
	let others = 0;
	for (const id of order) {
		if (id !== dragged) {
			if (others === at) entries.push(null);
			others += 1;
		}
		entries.push(id);
	}
	if (at >= others) entries.push(null);
	return entries;
}
