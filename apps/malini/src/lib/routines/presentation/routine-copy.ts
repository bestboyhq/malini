import type { RoutineStepKind } from '$lib/routines/domain/routine';

const TIMESTAMP_FORMAT = new Intl.DateTimeFormat(undefined, {
	month: 'short',
	day: 'numeric',
	hour: 'numeric',
	minute: '2-digit',
});

export const ROUTINE_STEP_KIND_LABELS: Readonly<Record<RoutineStepKind, string>> = {
	job: 'Job',
	command: 'Extension command',
	workflow: 'Workflow',
};

export function formatRoutineTimestamp(iso: string): string {
	const parsed = new Date(iso);
	return Number.isNaN(parsed.getTime()) ? iso : TIMESTAMP_FORMAT.format(parsed);
}
