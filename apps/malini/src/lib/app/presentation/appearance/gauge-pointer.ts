import type { Attachment } from 'svelte/attachments';
import type { GaugePoint } from '$lib/app/domain/tint-gauges';

export type GaugeDrag = Readonly<{
	onmove: (point: GaugePoint) => void;
	ongrab: () => void;
	onrelease: () => void;
	handle: () => Element | undefined;
}>;

const ARROWS: Readonly<Record<string, GaugePoint>> = {
	ArrowLeft: [-1, 0],
	ArrowRight: [1, 0],
	ArrowUp: [0, 1],
	ArrowDown: [0, -1],
};

export function gaugeDrag(drag: GaugeDrag): Attachment<HTMLElement> {
	return (element) => {
		let offset: GaugePoint = [0, 0];

		const move = (event: PointerEvent): void => {
			const box = element.getBoundingClientRect();
			drag.onmove([
				unit((event.clientX - offset[0] - box.left) / box.width),
				unit((event.clientY - offset[1] - box.top) / box.height),
			]);
		};
		const onpointerdown = (event: PointerEvent): void => {
			if (event.button !== 0) return;
			element.setPointerCapture(event.pointerId);
			offset = grabOffset(event, drag.handle());
			drag.ongrab();
			move(event);
		};
		const onpointermove = (event: PointerEvent): void => {
			if (element.hasPointerCapture(event.pointerId)) move(event);
		};
		const onlostpointercapture = (): void => drag.onrelease();

		element.addEventListener('pointerdown', onpointerdown);
		element.addEventListener('pointermove', onpointermove);
		element.addEventListener('lostpointercapture', onlostpointercapture);
		return () => {
			element.removeEventListener('pointerdown', onpointerdown);
			element.removeEventListener('pointermove', onpointermove);
			element.removeEventListener('lostpointercapture', onlostpointercapture);
		};
	};
}

export function arrowNudge(
	onnudge: (right: number, up: number) => void,
): (event: KeyboardEvent) => void {
	return (event) => {
		const direction = ARROWS[event.key];
		if (!direction) return;
		event.preventDefault();
		const step = event.shiftKey ? 4 : 1;
		onnudge(direction[0] * step, direction[1] * step);
	};
}

function grabOffset(event: PointerEvent, handle: Element | undefined): GaugePoint {
	if (!handle || !(event.target instanceof Node) || !handle.contains(event.target)) return [0, 0];
	const box = handle.getBoundingClientRect();
	return [event.clientX - (box.left + box.width / 2), event.clientY - (box.top + box.height / 2)];
}

function unit(value: number): number {
	return Math.min(1, Math.max(0, value));
}
