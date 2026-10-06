import type { RoutineJsonValue } from './routine';

export type RoutineGatedRunState = 'pending' | 'confirmed' | 'rejected';

export type RoutineGatedRun = Readonly<{
	id: string;
	routineId: string;
	workstreamId: string;
	runKey: string;
	event: string;
	payload: RoutineJsonValue;
	state: RoutineGatedRunState;
	createdAt: string;
	decidedAt: string | null;
}>;

export function sortGatedRunsOldestFirst(
	gatedRuns: readonly RoutineGatedRun[],
): readonly RoutineGatedRun[] {
	return [...gatedRuns].sort(
		(left, right) =>
			left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
	);
}
