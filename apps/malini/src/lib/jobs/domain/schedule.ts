import {
	parseAutomationTrigger,
	type Schedule,
	type ScheduleCadence,
	type ScheduleTrigger,
} from '$contract/automation-trigger';

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
	{ cadence, hour, minute }: Pick<Schedule, 'cadence' | 'hour' | 'minute'>,
	nowMs: number,
): number {
	const now = new Date(nowMs);
	for (let daysBack = 0; daysBack <= DAYS_OF_THE_WEEK.length; daysBack += 1) {
		const slot = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate() - daysBack,
			hour,
			minute,
		);
		if (slot.getTime() <= nowMs && runsOn(cadence, slot.getDay())) return slot.getTime();
	}
	return Number.NEGATIVE_INFINITY;
}

function runsOn(cadence: ScheduleCadence, day: number): boolean {
	if (cadence === 'day') return true;
	if (cadence === 'weekday') return day !== 0 && day !== 6;
	return DAYS_OF_THE_WEEK[day] === cadence;
}
