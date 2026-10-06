const STORAGE_KEY_PREFIX = 'malini.app.panel:';

export type ResizeAxis = 'horizontal' | 'vertical';

const MIN_PANEL_RATIO = 0.05;
const MAX_PANEL_RATIO = 0.95;

export function clampSize(value: number, min: number, max: number): number {
	if (Number.isNaN(value)) {
		return min;
	}
	if (!Number.isFinite(value)) {
		return value > 0 ? max : min;
	}
	if (value < min) return min;
	if (value > max) return max;
	return value;
}

export function clampRatio(value: number): number {
	if (!Number.isFinite(value)) {
		return 0.5;
	}
	return Math.min(MAX_PANEL_RATIO, Math.max(MIN_PANEL_RATIO, value));
}

export function defaultStorageKey(panelId: string): string {
	return `${STORAGE_KEY_PREFIX}${panelId}`;
}

function readRaw(storageKey: string): string | null {
	const storage = globalThis.localStorage;
	if (!storage) return null;
	try {
		return storage.getItem(storageKey);
	} catch {
		return null;
	}
}

function writeRaw(storageKey: string, value: string): void {
	const storage = globalThis.localStorage;
	if (!storage) return;
	try {
		storage.setItem(storageKey, value);
	} catch {
		void value;
	}
}

export function loadPanelSize(
	storageKey: string,
	fallback: number,
	min: number,
	max: number,
): number {
	const raw = readRaw(storageKey);
	if (raw === null) {
		return clampSize(fallback, min, max);
	}
	const parsed = Number.parseFloat(raw);
	if (!Number.isFinite(parsed)) {
		return clampSize(fallback, min, max);
	}
	return clampSize(parsed, min, max);
}

export function savePanelSize(storageKey: string, value: number): void {
	writeRaw(storageKey, String(Math.round(value)));
}

export function loadPanelRatio(storageKey: string, fallback: number): number {
	return readPanelRatio(storageKey) ?? clampRatio(fallback);
}

export function readPanelRatio(storageKey: string): number | null {
	const raw = readRaw(storageKey);
	if (raw === null || raw.trim() === '') return null;
	const parsed = Number.parseFloat(raw);
	return Number.isFinite(parsed) ? clampRatio(parsed) : null;
}

export function savePanelRatio(storageKey: string, value: number): void {
	writeRaw(storageKey, clampRatio(value).toFixed(6));
}

export function gridTemplate(size: number, axis: ResizeAxis): string {
	const px = `${Math.round(size)}px`;
	if (axis === 'horizontal') {
		return `${px} auto minmax(0, 1fr)`;
	}
	return `minmax(0, 1fr) auto ${px}`;
}

export function closedSecondaryGridTemplate(): string {
	return 'minmax(0, 1fr) auto';
}
