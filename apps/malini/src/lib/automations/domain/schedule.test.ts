import { describe, expect, it } from 'vitest';
import { latestScheduleSlot, scheduledAutomationOf } from './schedule';
import {
	DEFAULT_AUTOMATION_BOUNDARY,
	type AutomationDefinitionRecord,
	type AutomationTrigger,
} from '$contract/automations';

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

describe('scheduledAutomationOf', () => {
	const automation = (trigger: AutomationTrigger | null): AutomationDefinitionRecord => ({
		id: 'automation-1',
		name: 'Triage',
		instructions: 'Triage new issues',
		provider: 'claude',
		model: 'opus',
		effort: 'medium',
		runsIn: 'workstream',
		skills: [],
		builtin: null,
		trigger,
		thenAutomationId: null,
		boundary: DEFAULT_AUTOMATION_BOUNDARY,
		createdAt: '2026-10-01T00:00:00.000Z',
		updatedAt: '2026-10-01T00:00:00.000Z',
	});

	it('is the schedule of an automation that is not off', () => {
		expect(
			scheduledAutomationOf(automation({ when: 'every day at 09:00 in acme', mode: 'ask' })),
		).toMatchObject({
			mode: 'ask',
			schedule: { cadence: 'day', hour: 9, minute: 0, place: { kind: 'owner', owner: 'acme' } },
		});
	});

	it('is nothing for an off, unscheduled or triggerless automation', () => {
		expect(
			scheduledAutomationOf(automation({ when: 'every day at 09:00', mode: 'off' })),
		).toBeNull();
		expect(
			scheduledAutomationOf(automation({ when: 'on automations:run-changed', mode: 'auto' })),
		).toBeNull();
		expect(scheduledAutomationOf(automation(null))).toBeNull();
	});
});
