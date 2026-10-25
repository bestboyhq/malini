import { describe, expect, it } from 'vitest';
import { latestScheduleSlot, nextScheduleSlot, scheduledJobOf } from './schedule';
import type { JobDefinitionRecord, JobTrigger } from '$contract/jobs';

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

describe('nextScheduleSlot', () => {
	it('is today at the time until it passes, and tomorrow from then on', () => {
		const daily = { cadence: 'day', hour: 9, minute: 30 } as const;
		expect(nextScheduleSlot(daily, at(26, 9, 29))).toBe(at(26, 9, 30));
		expect(nextScheduleSlot(daily, at(26, 9, 30))).toBe(at(27, 9, 30));
	});

	it('skips the weekend for a weekday schedule', () => {
		const weekdays = { cadence: 'weekday', hour: 9, minute: 0 } as const;
		expect(nextScheduleSlot(weekdays, at(23, 12))).toBe(at(26, 9));
		expect(nextScheduleSlot(weekdays, at(25, 8))).toBe(at(26, 9));
		expect(nextScheduleSlot(weekdays, at(26, 8))).toBe(at(26, 9));
	});

	it('waits for the next time that day of the week comes', () => {
		const mondays = { cadence: 'monday', hour: 7, minute: 15 } as const;
		expect(nextScheduleSlot(mondays, at(26, 7, 14))).toBe(at(26, 7, 15));
		expect(nextScheduleSlot(mondays, at(26, 7, 15))).toBe(new Date(2026, 10, 2, 7, 15).getTime());
	});

	it('keeps the wall clock time across a daylight saving change', () => {
		const daily = { cadence: 'day', hour: 9, minute: 0 } as const;
		expect(new Date(nextScheduleSlot(daily, at(24, 10))).getHours()).toBe(9);
		expect(nextScheduleSlot(daily, at(24, 10))).toBe(at(25, 9));
	});
});

describe('scheduledJobOf', () => {
	const job = (trigger: JobTrigger | null): JobDefinitionRecord => ({
		id: 'job-1',
		name: 'Triage',
		instructions: 'Triage new issues',
		model: 'opus',
		effort: 'medium',
		runsIn: 'workstream',
		skills: [],
		builtin: null,
		trigger,
		thenJobId: null,
		createdAt: '2026-10-01T00:00:00.000Z',
		updatedAt: '2026-10-01T00:00:00.000Z',
	});

	it('is the schedule of a job that is not off', () => {
		expect(scheduledJobOf(job({ when: 'every day at 09:00 in acme', mode: 'ask' }))).toMatchObject({
			mode: 'ask',
			schedule: { cadence: 'day', hour: 9, minute: 0, place: { kind: 'owner', owner: 'acme' } },
		});
	});

	it('is nothing for an off, unscheduled or triggerless job', () => {
		expect(scheduledJobOf(job({ when: 'every day at 09:00', mode: 'off' }))).toBeNull();
		expect(scheduledJobOf(job({ when: 'on jobs:run-changed', mode: 'auto' }))).toBeNull();
		expect(scheduledJobOf(job(null))).toBeNull();
	});
});
