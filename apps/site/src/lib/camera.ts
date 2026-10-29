export type Size = Readonly<{ width: number; height: number }>;

export type Shot = Readonly<{ x: number; y: number; width: number; height: number }>;

export type Camera = Readonly<{ x: number; y: number; scale: number }>;

const MAX_ZOOM = 1.5;

const clamp = (value: number, low: number, high: number): number =>
	Math.min(high, Math.max(low, value));

function offset(size: number, room: number, center: number, scale: number): number {
	const shown = size * scale;
	if (shown <= room) return (room - shown) / 2;
	return clamp(room / 2 - center * scale, room - shown, 0);
}

export function cameraFor(app: Size, stage: Size, shot: Shot | null): Camera {
	const fit = Math.min(stage.width / app.width, stage.height / app.height);
	const scale = shot
		? clamp(Math.min(stage.width / shot.width, stage.height / shot.height), fit, MAX_ZOOM)
		: fit;
	const center = shot
		? { x: shot.x + shot.width / 2, y: shot.y + shot.height / 2 }
		: { x: app.width / 2, y: app.height / 2 };
	return {
		x: offset(app.width, stage.width, center.x, scale),
		y: offset(app.height, stage.height, center.y, scale),
		scale,
	};
}

const finite = (part: unknown): part is number => typeof part === 'number' && Number.isFinite(part);

export function shotOf(value: unknown): Shot | null {
	if (typeof value !== 'object' || value === null) return null;
	const x = 'x' in value ? value.x : null;
	const y = 'y' in value ? value.y : null;
	const width = 'width' in value ? value.width : null;
	const height = 'height' in value ? value.height : null;
	if (!finite(x) || !finite(y) || !finite(width) || !finite(height)) return null;
	return width > 0 && height > 0 ? { x, y, width, height } : null;
}

export const TOUR_MESSAGE = {
	camera: 'malini-demo:camera',
	ready: 'malini-demo:ready',
	play: 'malini-demo:play',
} as const;

export function messageType(data: unknown): string | null {
	return typeof data === 'object' &&
		data !== null &&
		'type' in data &&
		typeof data.type === 'string'
		? data.type
		: null;
}
