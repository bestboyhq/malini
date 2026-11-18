import { describe, expect, it } from 'vitest';
import {
	DEFAULT_VIDEO_PREFERENCES,
	nextVideoSpeed,
	parseVideoPreferences,
	VIDEO_SPEEDS,
} from './video-preferences';

describe('parseVideoPreferences', () => {
	it('reads what the store saved', () => {
		expect(parseVideoPreferences('{"muted":false,"volume":0.4,"speed":0.25}')).toEqual({
			muted: false,
			volume: 0.4,
			speed: 0.25,
		});
	});

	it('falls back field by field on anything it cannot trust', () => {
		expect(parseVideoPreferences(null)).toEqual(DEFAULT_VIDEO_PREFERENCES);
		expect(parseVideoPreferences('not json')).toEqual(DEFAULT_VIDEO_PREFERENCES);
		expect(parseVideoPreferences('[]')).toEqual(DEFAULT_VIDEO_PREFERENCES);
		expect(parseVideoPreferences('{"muted":"no","volume":3,"speed":2}')).toEqual(
			DEFAULT_VIDEO_PREFERENCES,
		);
		expect(parseVideoPreferences('{"volume":0}')).toEqual({ muted: true, volume: 0, speed: 1 });
	});
});

describe('nextVideoSpeed', () => {
	it('cycles full, half and quarter speed', () => {
		expect(VIDEO_SPEEDS.map(nextVideoSpeed)).toEqual([0.5, 0.25, 1]);
	});
});
