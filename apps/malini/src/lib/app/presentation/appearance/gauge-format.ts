import { kelvinAt } from '$lib/app/domain/tint-gauges';

export function degreesLabel(hue: number): string {
	return `${String(Math.round(hue) % 360).padStart(3, '0')}°`;
}

export function chromaLabel(chroma: number): string {
	return chroma.toFixed(4);
}

export function signedLabel(value: number): string {
	const rounded = Math.round(value);
	const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '±';
	return `${sign}${String(Math.abs(rounded)).padStart(2, '0')}`;
}

export function percentLabel(value: number): string {
	return signedLabel(Math.min(1, Math.max(-1, value)) * 100);
}

export function kelvinLabel(temperature: number): string {
	return `${kelvinAt(temperature)}K`;
}
