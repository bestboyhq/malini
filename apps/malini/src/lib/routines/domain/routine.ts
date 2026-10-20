export type RoutineStatus = 'draft' | 'candidate' | 'routine';

export type RoutineOrigin = 'user' | 'suggested';

export type RoutineJsonValue =
	| string
	| number
	| boolean
	| null
	| readonly RoutineJsonValue[]
	| { readonly [key: string]: RoutineJsonValue };

export type RoutineWorkflowRun = Readonly<{
	workflow: string;
	input: Readonly<Record<string, RoutineJsonValue>>;
}>;

export type RoutineCommandRun = Readonly<{
	command: string;
	args: readonly RoutineJsonValue[];
}>;

export type RoutineJobRun = Readonly<{ job: string }>;

export type RoutineRun = RoutineWorkflowRun | RoutineCommandRun | RoutineJobRun;

export type RoutineStepKind = 'job' | 'command' | 'workflow';

export const ROUTINE_LABEL_MAX_LENGTH = 120;

export const ROUTINE_MAX_STEPS = 10;

export type RoutinePromptEvidence = Readonly<{
	kind: 'prompt';
	text: string;
	runId?: string;
	sessionId?: string;
	workstreamId?: string;
	submittedAt?: string;
}>;

export type RoutineRunEvidence = Readonly<{
	kind: 'run';
	runId: string;
	sessionId?: string;
	workstreamId?: string;
	summary?: string;
}>;

export type RoutineEvidence = RoutinePromptEvidence | RoutineRunEvidence;

export type Routine = Readonly<{
	id: string;
	status: RoutineStatus;
	origin: RoutineOrigin;
	label: string;
	when: string;
	steps: readonly RoutineRun[];
	evidence: readonly RoutineEvidence[];
	createdAt: string;
	updatedAt: string;
}>;

export type RoutineChange = 'created' | 'updated' | 'promoted' | 'demoted' | 'deleted';

export type RoutinesLoadState = 'idle' | 'loading' | 'ready' | 'error';

export function routineStepKind(step: RoutineRun): RoutineStepKind {
	if ('job' in step) return 'job';
	return 'workflow' in step ? 'workflow' : 'command';
}

export function routineStepTarget(step: RoutineRun): string {
	if ('job' in step) return step.job;
	return 'workflow' in step ? step.workflow : step.command;
}

export function sortRoutinesOldestFirst(routines: readonly Routine[]): readonly Routine[] {
	return [...routines].sort(
		(left, right) =>
			left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
	);
}
