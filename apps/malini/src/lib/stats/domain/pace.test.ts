import { describe, expect, it } from 'vitest';
import { weekPace } from './pace';

const TODAY = '2026-11-02';
const USUAL = [
	{ date: '2026-09-29', runs: 40 },
	{ date: '2026-10-08', runs: 40 },
	{ date: '2026-10-15', runs: 40 },
	{ date: '2026-10-26', runs: 40 },
];

describe('week pace', () => {
	it('is crushing from three quarters of the usual week of the four before it', () => {
		expect(weekPace([...USUAL, { date: '2026-10-27', runs: 30 }], TODAY)).toEqual({
			pace: 'crushing',
			runs: 30,
		});
		expect(weekPace([...USUAL, { date: TODAY, runs: 29 }], TODAY)).toEqual({
			pace: 'warming-up',
			runs: 29,
		});
	});

	it('crushes on a first week and warms up on an empty one', () => {
		expect(weekPace([{ date: TODAY, runs: 1 }], TODAY).pace).toBe('crushing');
		expect(weekPace(USUAL, TODAY)).toEqual({ pace: 'warming-up', runs: 0 });
		expect(weekPace([], TODAY)).toEqual({ pace: 'warming-up', runs: 0 });
	});
});
