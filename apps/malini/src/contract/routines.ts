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

export type RoutineRecord = Readonly<{
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

export type RoutineGatedRunState = 'pending' | 'confirmed' | 'rejected';

export type RoutineGatedRunRecord = Readonly<{
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

export type RoutineSuggestionStatus = 'open' | 'dismissed' | 'accepted';

export type RoutineSuggestionRecord = Readonly<{
	id: string;
	clusterKey: string;
	status: RoutineSuggestionStatus;
	evidence: readonly RoutinePromptEvidence[];
	createdAt: string;
	updatedAt: string;
}>;

export type CreateRoutineDraftArgs = Readonly<{
	label: string;
	when: string;
	run: RoutineRun;
	origin?: RoutineOrigin;
	evidence?: readonly RoutineEvidence[];
	suggestionId?: string;
}>;

export type RoutineIdArgs = Readonly<{ routineId: string }>;

export type ListRoutineGatedRunsArgs = Readonly<{
	workstreamId?: string;
	state?: RoutineGatedRunState;
}>;

export type RecordRoutineGatedRunArgs = Readonly<{
	id: string;
	routineId: string;
	workstreamId: string;
	runKey: string;
	event: string;
	payload: RoutineJsonValue;
}>;

export type RoutineGatedRunIdArgs = Readonly<{ gatedRunId: string }>;

export type RoutineSuggestionIdArgs = Readonly<{ suggestionId: string }>;

export type RoutineCommandName =
	| 'routines.list'
	| 'routines.create-draft'
	| 'routines.promote'
	| 'routines.demote'
	| 'routines.delete'
	| 'routines.list-gated-runs'
	| 'routines.record-gated-run'
	| 'routines.confirm-run'
	| 'routines.reject-run'
	| 'routines.list-suggestions'
	| 'routines.dismiss-suggestion';

export type RoutineEventChannel =
	'routines:suggested' | 'routines:changed' | 'routines:gated-run-changed';

export type RoutineSuggestedEvent = Readonly<{
	suggestion: RoutineSuggestionRecord;
}>;

export type RoutineChange = 'created' | 'promoted' | 'demoted' | 'deleted';

export type RoutineChangedEvent = Readonly<{
	routineId: string;
	change: RoutineChange;
	routine: RoutineRecord | null;
}>;

export type RoutineGatedRunChangedEvent = Readonly<{
	gatedRun: RoutineGatedRunRecord;
}>;
