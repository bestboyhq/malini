import { MAX_TINT_CHROMA, type Appearance } from './appearance';
import type { Oklch } from './oklab';

export type GaugePoint = readonly [u: number, v: number];

export type Tint = Partial<Pick<Appearance, 'hue' | 'chroma'>>;

export const GAUGE_LIGHTNESS = 0.62;

export const TEMPERATURE_WARM_HUE = 65;
export const TEMPERATURE_COOL_HUE = 250;
export const TEMPERATURE_MAX_CHROMA = 0.03;

const NEUTRAL_REACH = 0.06;
const HUE_STEP = 3;
const REACH_STEP = 0.03;

const HUE_NAMES: readonly (readonly [below: number, name: string])[] = [
	[25, 'rose'],
	[50, 'clay'],
	[100, 'warm'],
	[170, 'sage'],
	[220, 'teal'],
	[280, 'cool'],
	[345, 'plum'],
	[360, 'rose'],
];

const CHROMA_NAMES: readonly (readonly [below: number, name: string])[] = [
	[0.0005, 'neutral'],
	[0.006, 'faint'],
	[0.012, 'subtle'],
	[0.025, 'noticeable'],
	[Infinity, 'strong'],
];

export function chromaAtReach(reach: number): number {
	return MAX_TINT_CHROMA * reach * reach;
}

export function reachOfChroma(chroma: number): number {
	return Math.sqrt(Math.max(0, chroma) / MAX_TINT_CHROMA);
}

export function gaugeColor(hue: number, chroma: number): Oklch {
	return { l: GAUGE_LIGHTNESS, c: chroma, h: hue };
}

export function wheelColorAt([u, v]: GaugePoint): Oklch {
	const x = u * 2 - 1;
	const y = 1 - v * 2;
	return gaugeColor(degrees(Math.atan2(y, x)), chromaAtReach(Math.min(1, Math.hypot(x, y))));
}

export function tintAtWheel([u, v]: GaugePoint): Tint {
	return tintAtVector(u * 2 - 1, 1 - v * 2);
}

export function wheelPointOf(appearance: Appearance): GaugePoint {
	const reach = reachOfChroma(appearance.chroma);
	return [
		0.5 + 0.5 * reach * Math.cos(radians(appearance.hue)),
		0.5 - 0.5 * reach * Math.sin(radians(appearance.hue)),
	];
}

export function nudgedTint(appearance: Appearance, hueSteps: number, reachSteps: number): Tint {
	return {
		hue: appearance.hue + hueSteps * HUE_STEP,
		chroma: chromaAtReach(clampUnit(reachOfChroma(appearance.chroma) + reachSteps * REACH_STEP)),
	};
}

export function temperatureOf(appearance: Appearance): number {
	const strength = Math.min(1, Math.sqrt(appearance.chroma / TEMPERATURE_MAX_CHROMA));
	return Math.cos(radians(appearance.hue - TEMPERATURE_WARM_HUE)) >= 0 ? strength : -strength;
}

export function tintAtTemperature(temperature: number): Tint {
	return {
		hue: temperature >= 0 ? TEMPERATURE_WARM_HUE : TEMPERATURE_COOL_HUE,
		chroma: TEMPERATURE_MAX_CHROMA * temperature * temperature,
	};
}

export function kelvinAt(temperature: number): number {
	return Math.round((6500 - Math.min(1, Math.max(-1, temperature)) * 2500) / 100) * 100;
}

export function hueName(hue: number): string {
	return HUE_NAMES.find(([below]) => hue < below)?.[1] ?? 'rose';
}

export function chromaName(chroma: number): string {
	return CHROMA_NAMES.find(([below]) => chroma < below)?.[1] ?? 'strong';
}

function tintAtVector(x: number, y: number): Tint {
	const reach = Math.min(1, Math.hypot(x, y));
	if (reach < NEUTRAL_REACH) return { chroma: 0 };
	return { hue: degrees(Math.atan2(y, x)), chroma: chromaAtReach(reach) };
}

function degrees(radiansValue: number): number {
	return ((radiansValue * 180) / Math.PI + 360) % 360;
}

function radians(degreesValue: number): number {
	return (degreesValue * Math.PI) / 180;
}

function clampUnit(value: number): number {
	return Math.min(1, Math.max(0, value));
}
