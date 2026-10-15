import { describe, expect, it } from 'vitest';
import { dayStreak, runsOn, shiftDate } from './activity';

const DAYS = [
	{ date: '2026-09-29', runs: 4 },
	{ date: '2026-09-30', runs: 1 },
	{ date: '2026-10-01', runs: 7 },
	{ date: '2026-10-03', runs: 2 },
];

describe('activity days', () => {
	it('counts the streak back from today, or from yesterday while today is still empty', () => {
		expect(dayStreak(DAYS, '2026-10-01')).toBe(3);
		expect(dayStreak(DAYS, '2026-10-02')).toBe(3);
		expect(dayStreak(DAYS, '2026-10-03')).toBe(1);
		expect(dayStreak(DAYS, '2026-10-05')).toBe(0);
	});

	it('reads the runs of one day and steps across month and year ends', () => {
		expect(runsOn(DAYS, '2026-10-01')).toBe(7);
		expect(runsOn(DAYS, '2026-10-02')).toBe(0);
		expect(shiftDate('2026-10-01', -1)).toBe('2026-09-30');
		expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
	});
});
