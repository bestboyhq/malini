import { SCROLL_SPRING_STIFFNESS } from './scroll-glide';

export type ArrivalMotion = {
	durationMs: number;
	easing: string;
	travelPx: number;
	promptOffsetPx: number;
	glideStiffness: number;
};

export const DEFAULT_ARRIVAL_MOTION: Readonly<ArrivalMotion> = {
	durationMs: 240,
	easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
	travelPx: 8,
	promptOffsetPx: 34,
	glideStiffness: SCROLL_SPRING_STIFFNESS,
};

const motion: ArrivalMotion = { ...DEFAULT_ARRIVAL_MOTION };

export function arrivalMotion(): Readonly<ArrivalMotion> {
	return motion;
}

export function setArrivalMotion(next: Partial<ArrivalMotion>): Readonly<ArrivalMotion> {
	if (typeof next.durationMs === 'number' && next.durationMs >= 0) {
		motion.durationMs = next.durationMs;
	}
	if (typeof next.easing === 'string' && next.easing.trim()) motion.easing = next.easing.trim();
	if (typeof next.travelPx === 'number' && Number.isFinite(next.travelPx)) {
		motion.travelPx = next.travelPx;
	}
	if (typeof next.promptOffsetPx === 'number' && Number.isFinite(next.promptOffsetPx)) {
		motion.promptOffsetPx = next.promptOffsetPx;
	}
	if (typeof next.glideStiffness === 'number' && next.glideStiffness > 0) {
		motion.glideStiffness = next.glideStiffness;
	}
	return motion;
}

export function resetArrivalMotion(): Readonly<ArrivalMotion> {
	Object.assign(motion, DEFAULT_ARRIVAL_MOTION);
	return motion;
}

export function exposeArrivalMotionForTuning(scope: object): () => void {
	Reflect.set(scope, 'chatArrivalMotion', motion);
	return () => {
		if (Reflect.get(scope, 'chatArrivalMotion') === motion) {
			Reflect.deleteProperty(scope, 'chatArrivalMotion');
		}
	};
}
