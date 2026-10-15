export type SidebarSlot = Readonly<{ top: number; bottom: number }>;

export function reorderIndex(slots: readonly SidebarSlot[], from: number, offset: number): number {
	const dragged = slots[from];
	if (!dragged) return from;
	let to = from;
	const height = dragged.bottom - dragged.top;
	slots.forEach((slot, index) => {
		const overlap = Math.min(height, slot.bottom - slot.top) / 2;
		if (index < from && dragged.top + offset < slot.bottom - overlap) to = Math.min(to, index);
		if (index > from && dragged.bottom + offset > slot.top + overlap) to = Math.max(to, index);
	});
	return to;
}

export function reorderShift(
	slots: readonly SidebarSlot[],
	from: number,
	to: number,
	index: number,
): number {
	const dragged = slots[from];
	const [first, second] = slots;
	if (!dragged || !first || !second) return 0;
	const stride = dragged.bottom - dragged.top + second.top - first.bottom;
	if (from < index && index <= to) return -stride;
	if (to <= index && index < from) return stride;
	return 0;
}

export function settledOffset(slots: readonly SidebarSlot[], from: number, to: number): number {
	const dragged = slots[from];
	const target = slots[to];
	if (!dragged || !target) return 0;
	if (to > from) return target.bottom - dragged.bottom;
	return target.top - dragged.top;
}
