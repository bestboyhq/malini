export type Point = readonly [number, number];

export type StageLighting = {
	spot: Point;
	spread: Point;
	floorFrom: Point;
	floorTo: Point;
};

export type StagePreset = 'bottom-left' | 'bottom-right';

export type StageFallback = {
	spot: string;
	spread: string;
	floor: string;
	floorFrom: string;
	floorTo: string;
};

export const STAGE_LIGHTING: Record<StagePreset, StageLighting> = {
	'bottom-left': {
		spot: [0, 1],
		spread: [1.1, 1.3],
		floorFrom: [1, 0],
		floorTo: [0, 1],
	},
	'bottom-right': {
		spot: [1, 1],
		spread: [1.1, 1.3],
		floorFrom: [0, 0],
		floorTo: [1, 1],
	},
};

export const CAST_SHADOW = { offsetY: 32, blur: 64, spread: -24 } as const;

const round = (value: number) => Math.round(value * 100) / 100;
const percent = (value: number) => `${round(value * 100)}%`;

export function stageFallback({ spot, spread, floorFrom, floorTo }: StageLighting): StageFallback {
	const angle = Math.atan2(floorTo[0] - floorFrom[0], floorFrom[1] - floorTo[1]);
	const sin = Math.sin(angle);
	const cos = Math.cos(angle);
	const along = ([x, y]: Point) =>
		((x - 0.5) * sin - (y - 0.5) * cos) / (Math.abs(sin) + Math.abs(cos)) + 0.5;
	return {
		spot: `${percent(spot[0])} ${percent(spot[1])}`,
		spread: `${percent(spread[0])} ${percent(spread[1])}`,
		floor: `${round(((angle * 180) / Math.PI + 360) % 360)}deg`,
		floorFrom: percent(along(floorFrom)),
		floorTo: percent(along(floorTo)),
	};
}
