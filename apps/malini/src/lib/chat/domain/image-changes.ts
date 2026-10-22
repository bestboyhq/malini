export type ImagePixels = Readonly<{ width: number; height: number; data: Uint8ClampedArray }>;

export type ChangedArea = Readonly<{ x: number; y: number; w: number; h: number }>;

export type ImageChanges = Readonly<{
	width: number;
	height: number;
	areas: readonly ChangedArea[];
	mask: Uint8ClampedArray;
}>;

type Rect = { left: number; top: number; right: number; bottom: number };

const CELL = 8;
const REACH = 2;
const THRESHOLD = 24;
const PAD = 18;
const MERGE = 24;
const ROW_TOLERANCE = 0.08;
const MASK_RGBA = [236, 72, 153, 255] as const;

export function imageChanges(before: ImagePixels, after: ImagePixels): ImageChanges | null {
	if (before.width !== after.width || before.height !== after.height) return null;
	const { width, height } = after;
	const mask = new Uint8ClampedArray(width * height * 4);
	const columns = Math.ceil(width / CELL);
	const rows = Math.ceil(height / CELL);
	const cells = new Uint8Array(columns * rows);
	for (let pixel = 0; pixel < width * height; pixel += 1) {
		if (!pixelChanged(before.data, after.data, pixel * 4)) continue;
		mask.set(MASK_RGBA, pixel * 4);
		const column = Math.floor((pixel % width) / CELL);
		const row = Math.floor(Math.floor(pixel / width) / CELL);
		cells[row * columns + column] = 1;
	}
	const rects = mergeNearby(
		clusters(cells, columns, rows).map((cluster) => ({
			left: Math.max(0, cluster.left * CELL - PAD),
			top: Math.max(0, cluster.top * CELL - PAD),
			right: Math.min(width, (cluster.right + 1) * CELL + PAD),
			bottom: Math.min(height, (cluster.bottom + 1) * CELL + PAD),
		})),
	);
	const areas = rects
		.map((rect) => ({
			x: rect.left / width,
			y: rect.top / height,
			w: (rect.right - rect.left) / width,
			h: (rect.bottom - rect.top) / height,
		}))
		.sort((a, b) => (Math.abs(a.y - b.y) < ROW_TOLERANCE ? a.x - b.x : a.y - b.y));
	return { width, height, areas, mask };
}

function pixelChanged(
	before: Uint8ClampedArray,
	after: Uint8ClampedArray,
	offset: number,
): boolean {
	for (let channel = 0; channel < 3; channel += 1) {
		const delta = Math.abs((before[offset + channel] ?? 0) - (after[offset + channel] ?? 0));
		if (delta >= THRESHOLD) return true;
	}
	return false;
}

function clusters(cells: Uint8Array, columns: number, rows: number): Rect[] {
	const seen = new Uint8Array(cells.length);
	const found: Rect[] = [];
	for (let start = 0; start < cells.length; start += 1) {
		if (!cells[start] || seen[start]) continue;
		seen[start] = 1;
		const queue = [start];
		const rect = { left: columns, top: rows, right: 0, bottom: 0 };
		for (let cell = queue.pop(); cell !== undefined; cell = queue.pop()) {
			const column = cell % columns;
			const row = Math.floor(cell / columns);
			rect.left = Math.min(rect.left, column);
			rect.right = Math.max(rect.right, column);
			rect.top = Math.min(rect.top, row);
			rect.bottom = Math.max(rect.bottom, row);
			for (let dy = -REACH; dy <= REACH; dy += 1) {
				for (let dx = -REACH; dx <= REACH; dx += 1) {
					const nextColumn = column + dx;
					const nextRow = row + dy;
					if (nextColumn < 0 || nextRow < 0 || nextColumn >= columns || nextRow >= rows) continue;
					const next = nextRow * columns + nextColumn;
					if (!cells[next] || seen[next]) continue;
					seen[next] = 1;
					queue.push(next);
				}
			}
		}
		found.push(rect);
	}
	return found;
}

// ponytail: restarts the pair scan after every merge, cubic in the area count; fine for the handful a screenshot has, sweep by x if diffs ever carry hundreds
function mergeNearby(rects: Rect[]): Rect[] {
	const merged = [...rects];
	for (let changed = true; changed;) {
		changed = false;
		for (let i = 0; i < merged.length && !changed; i += 1) {
			for (let j = i + 1; j < merged.length && !changed; j += 1) {
				const a = merged[i];
				const b = merged[j];
				if (!a || !b || !near(a, b)) continue;
				merged[i] = {
					left: Math.min(a.left, b.left),
					top: Math.min(a.top, b.top),
					right: Math.max(a.right, b.right),
					bottom: Math.max(a.bottom, b.bottom),
				};
				merged.splice(j, 1);
				changed = true;
			}
		}
	}
	return merged;
}

function near(a: Rect, b: Rect): boolean {
	return (
		a.left - MERGE < b.right &&
		b.left - MERGE < a.right &&
		a.top - MERGE < b.bottom &&
		b.top - MERGE < a.bottom
	);
}

export type ImageComparison =
	| Readonly<{ status: 'loading' | 'unavailable' }>
	| Readonly<{
			status: 'ready';
			width: number;
			height: number;
			areas: readonly ChangedArea[];
			maskUrl: string;
	  }>;

export type ImageComparisonRequest = Readonly<{
	workstreamId: string;
	before: string;
	after: string;
}>;

export function imageComparisonKey(request: ImageComparisonRequest): string {
	return [request.workstreamId, request.before, request.after].join('\u0000');
}
