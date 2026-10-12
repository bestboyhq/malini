import { isDefaultAppearance, type Appearance, type Theme } from './appearance';
import { contrastRatio, oklchCss, type Oklch } from './oklab';

export type GreyShade = Readonly<{ step: number; color: Oklch }>;

type ToneAnchors = Readonly<{
	background: number;
	far: number;
	bodyText: number;
	lift: number;
	dim: number;
}>;

const SHADES: readonly (readonly [step: number, lightness: number])[] = [
	[50, 0.989],
	[100, 0.971],
	[150, 0.954],
	[200, 0.937],
	[250, 0.9],
	[300, 0.881],
	[350, 0.848],
	[400, 0.775],
	[450, 0.676],
	[500, 0.607],
	[550, 0.548],
	[600, 0.51],
	[650, 0.429],
	[700, 0.373],
	[750, 0.335],
	[800, 0.307],
	[850, 0.281],
	[900, 0.24],
	[925, 0.218],
	[950, 0.193],
];

const THEMES: readonly Theme[] = ['dark', 'light'];

const TINT_SPREAD = { light: 0.15, middle: 1, dark: 0.5 } as const;

const TONE: Readonly<Record<Theme, ToneAnchors>> = {
	dark: { background: 19, far: 0, bodyText: 1, lift: 0.08, dim: 0.06 },
	light: { background: 3, far: 19, bodyText: 17, lift: 0.045, dim: 0.09 },
};

export const MIN_BODY_TEXT_CONTRAST = 4.6;

export function greyRamp(appearance: Appearance, theme: Theme): readonly GreyShade[] {
	const lightness = toneLightness(theme, appearance.brightness, appearance.contrast);
	const last = SHADES.length - 1;
	return SHADES.map(([step], index) => ({
		step,
		color: {
			l: lightness[index] ?? 0,
			c: appearance.chroma * tintWeight(index / last),
			h: appearance.hue,
		},
	}));
}

export function bodyTextContrast(appearance: Appearance, theme: Theme): number {
	const ramp = greyRamp(appearance, theme);
	const { background, bodyText } = TONE[theme];
	const text = ramp[bodyText];
	const surface = ramp[background];
	return text && surface ? contrastRatio(text.color, surface.color) : 0;
}

export function greyStylesheet(appearance: Appearance): string {
	if (isDefaultAppearance(appearance)) return '';
	return THEMES.map((theme) => {
		const tokens = greyRamp(appearance, theme)
			.map((shade) => `--color-grey-${shade.step}:${oklchCss(shade.color)};`)
			.join('');
		return `html[data-theme='${theme}']{${tokens}}`;
	}).join('\n');
}

function toneLightness(theme: Theme, brightness: number, contrast: number): readonly number[] {
	const anchors = TONE[theme];
	const base = SHADES.map(([, lightness]) => lightness);
	const at = (index: number): number => base[index] ?? 0;
	const background = at(anchors.background);
	const far = at(anchors.far);
	const near = at(anchors.far === 0 ? base.length - 1 : 0);
	const direction = Math.sign(far - background);

	const shiftedBackground = clampLightness(
		background + brightness * (brightness > 0 ? anchors.lift : anchors.dim),
	);
	const backgroundLuminance = shiftedBackground ** 3;
	const textLuminance =
		direction > 0
			? MIN_BODY_TEXT_CONTRAST * (backgroundLuminance + 0.05) - 0.05
			: (backgroundLuminance + 0.05) / MIN_BODY_TEXT_CONTRAST - 0.05;
	const textReach = (at(anchors.bodyText) - background) / (far - background);
	const farFloor =
		shiftedBackground +
		(Math.cbrt(Math.min(1, Math.max(0, textLuminance))) - shiftedBackground) / textReach;
	const wantedFar =
		shiftedBackground + (far - background) * (1 + (contrast < 0 ? 0.4 : 0.1) * contrast);
	const shiftedFar = clampLightness(
		direction > 0 ? Math.max(wantedFar, farFloor) : Math.min(wantedFar, farFloor),
	);
	const shiftedNear = clampLightness(near + (shiftedBackground - background));
	const ease = (progress: number): number =>
		contrast > 0 ? 1 - (1 - progress) ** (1 + 0.5 * contrast) : progress;

	return base.map((lightness) =>
		(lightness - background) * direction >= 0
			? shiftedBackground +
				(shiftedFar - shiftedBackground) * ease((lightness - background) / (far - background))
			: shiftedBackground +
				(shiftedNear - shiftedBackground) * ((lightness - background) / (near - background)),
	);
}

function tintWeight(progress: number): number {
	const { light, middle, dark } = TINT_SPREAD;
	if (progress < 0.5) return light + (middle - light) * Math.sin(((progress / 0.5) * Math.PI) / 2);
	return middle + (dark - middle) * (1 - Math.cos((((progress - 0.5) / 0.5) * Math.PI) / 2));
}

function clampLightness(value: number): number {
	return Math.min(0.995, Math.max(0.05, value));
}
