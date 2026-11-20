export type ReorderSlot = Readonly<{ start: number; end: number }>;

export function reorderIndex(slots: readonly ReorderSlot[], from: number, offset: number): number {
	const dragged = slots[from];
	if (!dragged) return from;
	let to = from;
	const size = dragged.end - dragged.start;
	slots.forEach((slot, index) => {
		const overlap = Math.min(size, slot.end - slot.start) / 2;
		if (index < from && dragged.start + offset < slot.end - overlap) to = Math.min(to, index);
		if (index > from && dragged.end + offset > slot.start + overlap) to = Math.max(to, index);
	});
	return to;
}

export function reorderShift(
	slots: readonly ReorderSlot[],
	from: number,
	to: number,
	index: number,
): number {
	const dragged = slots[from];
	const [first, second] = slots;
	if (!dragged || !first || !second) return 0;
	const stride = dragged.end - dragged.start + second.start - first.end;
	if (from < index && index <= to) return -stride;
	if (to <= index && index < from) return stride;
	return 0;
}

export function settledOffset(slots: readonly ReorderSlot[], from: number, to: number): number {
	const dragged = slots[from];
	const target = slots[to];
	if (!dragged || !target) return 0;
	if (to > from) return target.end - dragged.end;
	return target.start - dragged.start;
}
