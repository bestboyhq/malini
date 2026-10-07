export type ThemeMode = 'light' | 'dark';

export interface Appearance {
	darkBackground: number;
	lightBackground: number;
	tintHue: number;
	tintStrength: number;
	accent: string;
}

export interface AppearanceRange {
	min: number;
	max: number;
}

export const DEFAULT_APPEARANCE: Appearance = {
	darkBackground: 19,
	lightBackground: 99,
	tintHue: 55,
	tintStrength: 12,
	accent: '#0072F5',
};

export const DARK_BACKGROUND_RANGE: AppearanceRange = { min: 0, max: 34 };
export const LIGHT_BACKGROUND_RANGE: AppearanceRange = { min: 86, max: 100 };
export const TINT_HUE_RANGE: AppearanceRange = { min: 0, max: 359 };
export const TINT_STRENGTH_RANGE: AppearanceRange = { min: 0, max: 100 };

export const ACCENT_SWATCHES: string[] = [
	'#0072F5',
	'#4F46E5',
	'#7C3AED',
	'#C026D3',
	'#DB2777',
	'#E11D48',
	'#EA580C',
	'#D97706',
	'#65A30D',
	'#16A34A',
	'#0D9488',
	'#0891B2',
	'#475569',
	'#78716C',
];

const MAX_TINT_CHROMA = 0.04;

const GREY_LIGHTNESS: ReadonlyArray<readonly [step: number, lightness: number]> = [
	[50, 0.9888],
	[100, 0.9711],
	[150, 0.9539],
	[200, 0.9366],
	[250, 0.9001],
	[300, 0.8815],
	[350, 0.8476],
	[400, 0.7747],
	[450, 0.6759],
	[500, 0.6067],
	[550, 0.5478],
	[600, 0.5098],
	[650, 0.4288],
	[700, 0.3731],
	[750, 0.3346],
	[800, 0.3065],
	[850, 0.2812],
	[900, 0.2396],
	[950, 0.1932],
];

const LIGHTEST = 0.9888;
const DARKEST = 0.1932;

export function normalizeAppearance(raw: unknown): Appearance {
	if (typeof raw !== 'object' || raw === null) return DEFAULT_APPEARANCE;
	const field = (name: keyof Appearance): unknown =>
		name in raw ? Reflect.get(raw, name) : undefined;
	return {
		darkBackground: clampedNumber(
			field('darkBackground'),
			DARK_BACKGROUND_RANGE,
			DEFAULT_APPEARANCE.darkBackground,
		),
		lightBackground: clampedNumber(
			field('lightBackground'),
			LIGHT_BACKGROUND_RANGE,
			DEFAULT_APPEARANCE.lightBackground,
		),
		tintHue: clampedNumber(field('tintHue'), TINT_HUE_RANGE, DEFAULT_APPEARANCE.tintHue),
		tintStrength: clampedNumber(
			field('tintStrength'),
			TINT_STRENGTH_RANGE,
			DEFAULT_APPEARANCE.tintStrength,
		),
		accent: isHexColor(field('accent'))
			? String(field('accent')).toUpperCase()
			: DEFAULT_APPEARANCE.accent,
	};
}

export function isDefaultAppearance(appearance: Appearance): boolean {
	return appearanceStyles(appearance) === '';
}

export function appearanceStyles(appearance: Appearance): string {
	const tintChanged =
		appearance.tintHue !== DEFAULT_APPEARANCE.tintHue ||
		appearance.tintStrength !== DEFAULT_APPEARANCE.tintStrength;
	const blocks: string[] = [];
	if (tintChanged || appearance.darkBackground !== DEFAULT_APPEARANCE.darkBackground) {
		blocks.push(rampBlock('dark', appearance));
	}
	if (tintChanged || appearance.lightBackground !== DEFAULT_APPEARANCE.lightBackground) {
		blocks.push(rampBlock('light', appearance));
	}
	if (appearance.accent.toUpperCase() !== DEFAULT_APPEARANCE.accent) {
		blocks.push(accentBlock(appearance.accent));
	}
	return blocks.join('\n');
}

function rampBlock(mode: ThemeMode, appearance: Appearance): string {
	const chroma = (appearance.tintStrength / 100) * MAX_TINT_CHROMA;
	const declarations = GREY_LIGHTNESS.map(([step, lightness]) => {
		const shifted = shiftedLightness(mode, lightness, appearance);
		return `--color-grey-${step}: oklch(${round(shifted)} ${round(chroma)} ${appearance.tintHue});`;
	});
	return `html[data-theme='${mode}'] { ${declarations.join(' ')} }`;
}

function shiftedLightness(mode: ThemeMode, lightness: number, appearance: Appearance): number {
	if (mode === 'dark') {
		const darkest = appearance.darkBackground / 100;
		return LIGHTEST - ((LIGHTEST - lightness) * (LIGHTEST - darkest)) / (LIGHTEST - DARKEST);
	}
	const lightest = appearance.lightBackground / 100;
	return DARKEST + ((lightness - DARKEST) * (lightest - DARKEST)) / (LIGHTEST - DARKEST);
}

function accentBlock(accent: string): string {
	const strong = `oklch(from ${accent} calc(l - 0.045) c h)`;
	const soft = `oklch(from ${accent} calc(l + 0.14) calc(c * 0.7) h)`;
	const content = relativeLuminance(accent) > 0.4 ? 'var(--color-grey-950)' : 'var(--color-grey-50)';
	return [
		`html[data-theme] {`,
		`--color-brand-light: ${accent}; --color-brand-dark: ${accent};`,
		`--color-brand-icon-light: ${strong}; --color-brand-foreground-light: ${strong};`,
		`--color-brand-icon-dark: ${soft}; --color-brand-foreground-dark: ${soft};`,
		`--color-brand-content-light: ${content}; --color-brand-content-dark: ${content};`,
		`}`,
	].join(' ');
}

function relativeLuminance(hex: string): number {
	const [red = 0, green = 0, blue = 0] = [1, 3, 5].map((start) => {
		const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
		return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function clampedNumber(value: unknown, range: AppearanceRange, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

function isHexColor(value: unknown): boolean {
	return typeof value === 'string' && /^#[0-9a-f]{6}$/iu.test(value);
}

function round(value: number): number {
	return Math.round(value * 10000) / 10000;
}
