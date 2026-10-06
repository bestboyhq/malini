export type OverflowTab = Readonly<{
	key: string;
	name: string;
	detail: string;
	selected: boolean;
	open: () => void;
}>;

export interface OverflowTabMeasurements {
	availableWidth: number;
	reservedWidth: number;
	overflowWidth: number;
	itemWidths: Readonly<Record<string, number>>;
	gap: number;
}

export interface OverflowTabResult<T> {
	visible: T[];
	hidden: T[];
}

export function computeOverflowTabs<T>(input: {
	items: readonly T[];
	getId: (item: T) => string;
	pinnedId: string | null;
	measurements: OverflowTabMeasurements;
	fallbackVisibleCount?: number;
}): OverflowTabResult<T> {
	const { items, getId, pinnedId, measurements, fallbackVisibleCount = 3 } = input;
	if (!hasMeasurements(items, getId, measurements)) {
		return splitTabs(items, getId, pinnedId, Math.min(fallbackVisibleCount, items.length));
	}

	let lower = 0;
	let upper = items.length;
	while (lower < upper) {
		const candidate = Math.ceil((lower + upper) / 2);
		const split = splitTabs(items, getId, pinnedId, candidate);
		if (
			tabsWidth(split.visible, items.length, getId, measurements) <= measurements.availableWidth
		) {
			lower = candidate;
		} else {
			upper = candidate - 1;
		}
	}

	const minimumVisible = pinnedId && items.some((item) => getId(item) === pinnedId) ? 1 : 0;
	return splitTabs(items, getId, pinnedId, Math.max(lower, minimumVisible));
}

function hasMeasurements<T>(
	items: readonly T[],
	getId: (item: T) => string,
	measurements: OverflowTabMeasurements,
): boolean {
	if (measurements.availableWidth <= 0 || measurements.reservedWidth <= 0) return false;
	return items.every((item) => (measurements.itemWidths[getId(item)] ?? 0) > 0);
}

function splitTabs<T>(
	items: readonly T[],
	getId: (item: T) => string,
	pinnedId: string | null,
	limit: number,
): OverflowTabResult<T> {
	const visible = items.slice(0, Math.max(0, limit));
	const pinned = pinnedId ? items.find((item) => getId(item) === pinnedId) : undefined;
	if (pinned && !visible.some((item) => getId(item) === pinnedId)) {
		if (limit <= 0) visible.push(pinned);
		else visible.splice(visible.length - 1, 1, pinned);
	}
	const visibleIds = new Set(visible.map(getId));
	return {
		visible,
		hidden: items.filter((item) => !visibleIds.has(getId(item))),
	};
}

function tabsWidth<T>(
	visible: readonly T[],
	totalCount: number,
	getId: (item: T) => string,
	measurements: OverflowTabMeasurements,
): number {
	const visibleWidth = visible.reduce(
		(total, item) => total + (measurements.itemWidths[getId(item)] ?? 0),
		0,
	);
	const hasOverflow = visible.length < totalCount;
	const itemCount = visible.length + 1 + (hasOverflow ? 1 : 0);
	return (
		visibleWidth +
		measurements.reservedWidth +
		(hasOverflow ? measurements.overflowWidth : 0) +
		Math.max(0, itemCount - 1) * measurements.gap
	);
}
