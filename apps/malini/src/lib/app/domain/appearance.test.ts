import { describe, expect, it } from 'vitest';
import {
	DEFAULT_APPEARANCE,
	MAX_TINT_CHROMA,
	parseAppearance,
	tunedAppearance,
	type Appearance,
	type Theme,
} from './appearance';
import { bodyTextContrast, greyRamp, greyStylesheet } from './grey-ramp';
import { temperatureOf, tintAtTemperature, tintAtWheel, wheelPointOf } from './tint-gauges';

const LEVELS = [-1, -0.6, -0.2, 0, 0.2, 0.6, 1];
const THEMES: readonly Theme[] = ['dark', 'light'];

function everyTone(): Appearance[] {
	return LEVELS.flatMap((brightness) =>
		LEVELS.map((contrast) => ({ hue: 250, chroma: MAX_TINT_CHROMA, brightness, contrast })),
	);
}

describe('grey ramp', () => {
	it.each(THEMES)('keeps the %s greys ordered from light to dark at every tone', (theme) => {
		for (const appearance of everyTone()) {
			const lightness = greyRamp(appearance, theme).map((shade) => shade.color.l);
			const sorted = [...lightness].sort((a, b) => b - a);
			expect(lightness).toEqual(sorted);
		}
	});

	it.each(THEMES)('keeps %s body text readable at every tone', (theme) => {
		for (const appearance of everyTone()) {
			expect(bodyTextContrast(appearance, theme)).toBeGreaterThanOrEqual(4.5);
		}
	});

	it('leaves the shipped greys alone at the default appearance', () => {
		expect(greyStylesheet(DEFAULT_APPEARANCE)).toBe('');
	});

	it('writes all twenty greys for both themes once tuned', () => {
		const sheet = greyStylesheet({ ...DEFAULT_APPEARANCE, hue: 250 });
		expect(sheet.match(/--color-grey-\d+:/gu)).toHaveLength(40);
		expect(sheet).toContain("html[data-theme='dark']");
		expect(sheet).toContain("html[data-theme='light']");
	});
});

describe('tint gauges', () => {
	const tint = { ...DEFAULT_APPEARANCE, hue: 250, chroma: 0.02 };

	it('the wheel reads back the tint it shows', () => {
		const read = tunedAppearance(tint, tintAtWheel(wheelPointOf(tint)));
		expect(read.hue).toBeCloseTo(tint.hue, 6);
		expect(read.chroma).toBeCloseTo(tint.chroma, 6);
	});

	it('maps the temperature lever onto warm and cool tints and back', () => {
		for (const temperature of [-1, -0.5, 0.5, 1]) {
			const read = tunedAppearance(tint, tintAtTemperature(temperature));
			expect(temperatureOf(read)).toBeCloseTo(temperature, 6);
		}
	});
});

describe('stored appearance', () => {
	it('falls back to the default for anything that is not an appearance', () => {
		expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
		expect(parseAppearance('slate')).toEqual(DEFAULT_APPEARANCE);
		expect(parseAppearance({ hue: 'warm', chroma: Number.NaN })).toEqual(DEFAULT_APPEARANCE);
	});

	it('clamps out-of-range values instead of trusting them', () => {
		expect(parseAppearance({ hue: 725, chroma: 1, brightness: 9, contrast: -9 })).toEqual({
			hue: 5,
			chroma: MAX_TINT_CHROMA,
			brightness: 1,
			contrast: -1,
		});
	});
});
