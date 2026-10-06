import type { Attachment } from 'svelte/attachments';

export interface ToastLane {
	left: number;
	right: number;
}

const VISIBLE_TOASTS = 3;
const TALLEST_TOAST_PX = 76;
const STACK_GAP_PX = 14;
// ponytail: assumes an expanded stack of three toasts of up to three lines; measure sonner's toast heights if a taller stack reaches an avoided element.
const STACK_REACH_PX = VISIBLE_TOASTS * TALLEST_TOAST_PX + (VISIBLE_TOASTS - 1) * STACK_GAP_PX;

const avoided = new Set<Element>();

export const avoidedByToasts: Attachment = (element) => {
	avoided.add(element);
	return () => {
		avoided.delete(element);
	};
};

export function bottomOffsetClearOfAvoided(lane: ToastLane, edge: number): number {
	const floor = window.innerHeight - edge;
	let bottom = edge;
	for (const element of avoided) {
		const box = element.getBoundingClientRect();
		const inLane = box.width > 0 && box.left < lane.right && box.right > lane.left;
		if (!inLane || box.bottom <= floor - STACK_REACH_PX) continue;
		bottom = Math.max(bottom, window.innerHeight - box.top + edge);
	}
	return bottom;
}
