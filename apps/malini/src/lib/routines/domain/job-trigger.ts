import { parseAutomationTrigger } from '$contract/automation-trigger';
import type { JobTrigger } from '$contract/routines';
import type { Routine, RoutineStatus } from './routine';

export type RoutineStatusStep = 'promote' | 'demote';

const STATUS_ORDER: readonly RoutineStatus[] = ['draft', 'candidate', 'routine'];

export function isJobOwnRoutine(routine: Pick<Routine, 'steps'>, jobId: string): boolean {
	const [only, ...rest] = routine.steps;
	return rest.length === 0 && only !== undefined && 'job' in only && only.job === jobId;
}

export function ownRoutineOf(routines: readonly Routine[], jobId: string): Routine | null {
	return routines.find((routine) => isJobOwnRoutine(routine, jobId)) ?? null;
}

export function jobTriggerOf(routines: readonly Routine[], jobId: string): JobTrigger | null {
	const own = ownRoutineOf(routines, jobId);
	if (own === null || isManualWhen(own.when)) return null;
	return { when: own.when, status: own.status };
}

export function statusSteps(from: RoutineStatus, to: RoutineStatus): readonly RoutineStatusStep[] {
	const distance = STATUS_ORDER.indexOf(to) - STATUS_ORDER.indexOf(from);
	return Array.from({ length: Math.abs(distance) }, () => (distance > 0 ? 'promote' : 'demote'));
}

function isManualWhen(when: string): boolean {
	try {
		return parseAutomationTrigger(when).kind === 'manual';
	} catch {
		return false;
	}
}
