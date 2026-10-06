export type ArrivalMotion = {
	durationMs: number;
	easing: string;
	travelPx: number;
	promptOffsetPx: number;
	scrollStiffness: number;
	layoutStiffness: number;
};

export const DEFAULT_ARRIVAL_MOTION: Readonly<ArrivalMotion> = {
	durationMs: 380,

	easing: 'cubic-bezier(0.32, 0.72, 0, 1)',

	travelPx: 14,

	promptOffsetPx: 34,
	scrollStiffness: 220,
	layoutStiffness: 320,
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
	if (typeof next.scrollStiffness === 'number' && next.scrollStiffness > 0) {
		motion.scrollStiffness = next.scrollStiffness;
	}
	if (typeof next.layoutStiffness === 'number' && next.layoutStiffness > 0) {
		motion.layoutStiffness = next.layoutStiffness;
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
