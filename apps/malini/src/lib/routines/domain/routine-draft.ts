import type { RoutineEvidence, RoutineOrigin, RoutineRun } from './routine';

export type RoutineDraft = Readonly<{
	label: string;
	when: string;
	run: RoutineRun;
	origin?: RoutineOrigin;
	evidence?: readonly RoutineEvidence[];
	suggestionId?: string;
}>;
