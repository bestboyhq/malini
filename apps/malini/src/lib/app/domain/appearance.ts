export type ThemeMode = 'system' | 'light' | 'dark';

export type Theme = 'light' | 'dark';

export type Appearance = Readonly<{
	hue: number;
	chroma: number;
	brightness: number;
	contrast: number;
}>;

export type GreyPreset = Readonly<{ name: string; hue: number; chroma: number }>;

export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

export const MAX_TINT_CHROMA = 0.05;

export const DEFAULT_APPEARANCE: Appearance = {
	hue: 55,
	chroma: 0.0076,
	brightness: 0,
	contrast: 0,
};

export const GREY_PRESETS: readonly GreyPreset[] = [
	{ name: 'Neutral', hue: 0, chroma: 0 },
	{ name: 'Stone', hue: 55, chroma: 0.0076 },
	{ name: 'Paper', hue: 85, chroma: 0.01 },
	{ name: 'Sand', hue: 70, chroma: 0.016 },
	{ name: 'Clay', hue: 40, chroma: 0.014 },
	{ name: 'Rose', hue: 10, chroma: 0.011 },
	{ name: 'Plum', hue: 325, chroma: 0.012 },
	{ name: 'Sage', hue: 145, chroma: 0.011 },
	{ name: 'Slate', hue: 250, chroma: 0.013 },
	{ name: 'Ink', hue: 265, chroma: 0.024 },
];

const NEUTRAL_BELOW_CHROMA = 0.0005;

export function tunedAppearance(current: Appearance, patch: Partial<Appearance>): Appearance {
	const next = { ...current, ...patch };
	return {
		hue: ((next.hue % 360) + 360) % 360,
		chroma: clamp(next.chroma, 0, MAX_TINT_CHROMA),
		brightness: clamp(next.brightness, -1, 1),
		contrast: clamp(next.contrast, -1, 1),
	};
}

export function parseAppearance(raw: unknown): Appearance {
	if (typeof raw !== 'object' || raw === null) return DEFAULT_APPEARANCE;
	const read = (key: keyof Appearance): number => {
		const value: unknown = Reflect.get(raw, key);
		return typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_APPEARANCE[key];
	};
	return tunedAppearance(DEFAULT_APPEARANCE, {
		hue: read('hue'),
		chroma: read('chroma'),
		brightness: read('brightness'),
		contrast: read('contrast'),
	});
}

export function parseThemeMode(raw: unknown): ThemeMode {
	return THEME_MODES.find((mode) => mode === raw) ?? 'system';
}

export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): Theme {
	if (mode !== 'system') return mode;
	return systemPrefersDark ? 'dark' : 'light';
}

export function isDefaultAppearance(appearance: Appearance): boolean {
	return sameAppearance(appearance, DEFAULT_APPEARANCE);
}

export function sameAppearance(first: Appearance, second: Appearance): boolean {
	return (
		first.hue === second.hue &&
		first.chroma === second.chroma &&
		first.brightness === second.brightness &&
		first.contrast === second.contrast
	);
}

export function isNeutral(appearance: Appearance): boolean {
	return appearance.chroma < NEUTRAL_BELOW_CHROMA;
}

export function matchingPreset(appearance: Appearance): GreyPreset | null {
	return (
		GREY_PRESETS.find((preset) =>
			preset.chroma === 0
				? isNeutral(appearance)
				: Math.abs(preset.chroma - appearance.chroma) < NEUTRAL_BELOW_CHROMA &&
					Math.abs(preset.hue - appearance.hue) < 2,
		) ?? null
	);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
