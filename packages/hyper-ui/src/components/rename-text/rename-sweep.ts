import { sineInOut } from 'svelte/easing';

export const RENAME_SWEEP_MS = 1500;
export const RENAME_BAND_PX = 20;
export const RENAME_SEAM_PX = 1.6;

const SWEEP_SHARE = 0.9;

export type RenameSweepFrame = {
	readonly center: number;
	readonly width: number;
	readonly dim: number;
};

export function renameSweepFrame(
	progress: number,
	fromWidth: number,
	toWidth: number,
): RenameSweepFrame {
	const widest = Math.max(fromWidth, toWidth);
	const sweep = sineInOut(clamp01(progress / SWEEP_SHARE));
	const center = -RENAME_BAND_PX / 2 + sweep * (widest + RENAME_BAND_PX);
	const lead = center + RENAME_BAND_PX / 2;
	return {
		center,
		width: labelWidth(lead, fromWidth, toWidth),
		dim: smoothstep(0, 0.12, progress) * (1 - smoothstep(0.78, 1, progress)),
	};
}

function labelWidth(lead: number, fromWidth: number, toWidth: number): number {
	if (toWidth < fromWidth) {
		const settle = smoothstep(
			Math.max(0, fromWidth - RENAME_BAND_PX / 2),
			fromWidth + RENAME_BAND_PX / 2,
			lead,
		);
		return fromWidth + (toWidth - fromWidth) * settle;
	}
	const growth = toWidth - fromWidth;
	const pushed = smoothMax(lead, fromWidth, Math.min(RENAME_BAND_PX / 2, fromWidth, growth));
	return smoothMin(pushed, toWidth, Math.min(RENAME_BAND_PX, growth));
}

function smoothMax(a: number, b: number, radius: number): number {
	const distance = Math.abs(a - b);
	const blend = distance < radius ? (radius - distance) ** 2 / (4 * radius) : 0;
	return Math.max(a, b) + blend;
}

function smoothMin(a: number, b: number, radius: number): number {
	return -smoothMax(-a, -b, radius);
}

function smoothstep(from: number, to: number, value: number): number {
	const t = clamp01((value - from) / (to - from));
	return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
	return Math.min(Math.max(value, 0), 1);
}
