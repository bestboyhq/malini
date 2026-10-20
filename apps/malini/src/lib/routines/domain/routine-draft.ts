import type { RoutineEvidence, RoutineOrigin, RoutineRun } from './routine';

export type RoutineDraft = Readonly<{
	label: string;
	when: string;
	steps: readonly RoutineRun[];
	origin?: RoutineOrigin;
	evidence?: readonly RoutineEvidence[];
	suggestionId?: string;
}>;

export type RoutineUpdate = Readonly<{
	label: string;
	when: string;
	steps: readonly RoutineRun[];
}>;

export type RoutineFormSeed = Readonly<{
	label: string;
	when: string;
	steps: readonly RoutineRun[];
	suggestionId: string;
	evidenceCount: number;
}>;
