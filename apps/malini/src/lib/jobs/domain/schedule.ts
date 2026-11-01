import {
	parseAutomationTrigger,
	type Schedule,
	type ScheduleCadence,
	type ScheduleTrigger,
} from '$contract/automation-trigger';
import type { JobDefinitionRecord, JobRunMode } from '$contract/jobs';

export type ScheduledJob = Readonly<{
	definition: JobDefinitionRecord;
	mode: Exclude<JobRunMode, 'off'>;
	schedule: ScheduleTrigger;
}>;

const DAYS_OF_THE_WEEK: readonly ScheduleCadence[] = [
	'sunday',
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday',
];

export function scheduleOf(when: string | null | undefined): ScheduleTrigger | null {
	if (!when) return null;
	try {
		const trigger = parseAutomationTrigger(when);
		return trigger.kind === 'schedule' ? trigger : null;
	} catch {
		return null;
	}
}

export function latestScheduleSlot(
	schedule: Pick<Schedule, 'cadence' | 'hour' | 'minute'>,
	nowMs: number,
): number {
	return firstScheduleSlot(schedule, nowMs, -1);
}

export function scheduledJobOf(definition: JobDefinitionRecord): ScheduledJob | null {
	const mode = definition.trigger?.mode ?? 'off';
	const schedule = scheduleOf(definition.trigger?.when);
	return mode !== 'off' && schedule ? { definition, mode, schedule } : null;
}

function firstScheduleSlot(
	{ cadence, hour, minute }: Pick<Schedule, 'cadence' | 'hour' | 'minute'>,
	nowMs: number,
	direction: 1 | -1,
): number {
	const now = new Date(nowMs);
	for (let days = 0; days <= DAYS_OF_THE_WEEK.length; days += 1) {
		const slot = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate() + direction * days,
			hour,
			minute,
		);
		const onTime = direction > 0 ? slot.getTime() > nowMs : slot.getTime() <= nowMs;
		if (onTime && runsOn(cadence, slot.getDay())) return slot.getTime();
	}
	return direction * Number.POSITIVE_INFINITY;
}

function runsOn(cadence: ScheduleCadence, day: number): boolean {
	if (cadence === 'day') return true;
	if (cadence === 'weekday') return day !== 0 && day !== 6;
	return DAYS_OF_THE_WEEK[day] === cadence;
}
