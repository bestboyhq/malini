export const ROUTINE_DRAFT_ACTION_ID = 'routines.draft';

export const ROUTINE_NEW_JOB_ACTION_ID = 'routines.new-job';

export function jobTriggerActionId(jobId: string): string {
	return `routines.job-trigger:${jobId}`;
}

export function routineUpdateActionId(routineId: string): string {
	return `routines.update:${routineId}`;
}

export function routineRunActionId(routineId: string): string {
	return `routines.run:${routineId}`;
}

export type RoutineActionState = Readonly<{
	busy: boolean;
	error: string | null;
	completed: number;
}>;
