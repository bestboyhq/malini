import { describe, expect, it } from 'vitest';
import { latestScheduleSlot } from './schedule';

const at = (day: number, hour: number, minute = 0): number =>
	new Date(2026, 9, day, hour, minute).getTime();

describe('latestScheduleSlot', () => {
	it('is today at the time once it passed, and yesterday before it', () => {
		const daily = { cadence: 'day', hour: 9, minute: 30 } as const;
		expect(latestScheduleSlot(daily, at(26, 9, 30))).toBe(at(26, 9, 30));
		expect(latestScheduleSlot(daily, at(26, 9, 29))).toBe(at(25, 9, 30));
	});

	it('skips the weekend for a weekday schedule', () => {
		const weekdays = { cadence: 'weekday', hour: 9, minute: 0 } as const;
		expect(latestScheduleSlot(weekdays, at(25, 12))).toBe(at(23, 9));
		expect(latestScheduleSlot(weekdays, at(26, 8))).toBe(at(23, 9));
		expect(latestScheduleSlot(weekdays, at(26, 9))).toBe(at(26, 9));
	});

	it('goes back to the last time that day of the week came', () => {
		const mondays = { cadence: 'monday', hour: 7, minute: 15 } as const;
		expect(latestScheduleSlot(mondays, at(26, 7, 14))).toBe(at(19, 7, 15));
		expect(latestScheduleSlot(mondays, at(31, 23))).toBe(at(26, 7, 15));
	});
});
