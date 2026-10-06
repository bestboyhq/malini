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

export type RoutineRun = RoutineWorkflowRun | RoutineCommandRun;

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
	run: RoutineRun;
	evidence: readonly RoutineEvidence[];
	createdAt: string;
	updatedAt: string;
}>;

export type RoutineChange = 'created' | 'promoted' | 'demoted' | 'deleted';

export type RoutinesLoadState = 'idle' | 'loading' | 'ready' | 'error';

export function routineRunTarget(run: RoutineRun): string {
	return 'workflow' in run ? run.workflow : run.command;
}

export function sortRoutinesOldestFirst(routines: readonly Routine[]): readonly Routine[] {
	return [...routines].sort(
		(left, right) =>
			left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
	);
}
