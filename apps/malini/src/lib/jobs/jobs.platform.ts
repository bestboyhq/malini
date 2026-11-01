import {
	DEFAULT_JOB_BOUNDARY,
	isShippingJobBuiltin,
	type JobBoundary,
	type JobDefinitionRecord,
	type JobRunRecord,
} from '$contract/jobs';
import type { MaliniDatabase } from '$main/db/driver';
import type { DispatchedEvent } from './platform/event-log.service';
import { getJobDefinition, listJobDefinitions } from './platform/job-definitions.repository';
import {
	activeWorkstreamJobRun,
	findActiveJobRunForSession,
	getJobRun,
	latestJobRunForSession,
	latestWorkstreamJobRun,
} from './platform/job-runs.repository';

export { JOB_CONTEXT_MAX_BYTES } from './domain/job-run';
export { clearAlarm, setAlarm } from './platform/alarms.repository';
export { startingSessionId } from './platform/agent-actions.repository';
export { heardBack, latestLoggedEvent } from './platform/event-log.repository';
export { handledEvent, type DispatchedEvent } from './platform/event-log.service';
export {
	finishAgentAction,
	recordAgentAction,
	type AgentActionContext,
	type AgentActionStart,
} from './platform/agent-actions.service';
export {
	runAutomaticJob,
	type AutomaticJob,
	type ChooseWithJob,
	type SuggestWithJob,
} from './platform/automatic-jobs.service';

export interface JobsPlatform {
	start(): void;
	dispose(): void;
}

export type ShippingDecision = Readonly<{
	move: string;
	act(event: DispatchedEvent): Promise<void>;
}>;

export type ShippingRule = Readonly<{
	hear(event: DispatchedEvent): Promise<readonly string[]>;
	decide(workstreamId: string): Promise<ShippingDecision | null>;
	merging(workstreamId: string): boolean;
}>;

export function jobDefinitions(db: MaliniDatabase): JobDefinitionRecord[] {
	return listJobDefinitions(db);
}

export function activeJobRunForSession(db: MaliniDatabase, sessionId: string): JobRunRecord | null {
	return findActiveJobRunForSession(db, sessionId);
}

export function jobBoundaryForSession(db: MaliniDatabase, sessionId: string): JobBoundary | null {
	const run = latestJobRunForSession(db, sessionId);
	return run === null
		? null
		: (getJobDefinition(db, run.definitionId)?.boundary ?? DEFAULT_JOB_BOUNDARY);
}

export function jobDefinition(db: MaliniDatabase, id: string): JobDefinitionRecord | null {
	return getJobDefinition(db, id);
}

export function jobRun(db: MaliniDatabase, id: string): JobRunRecord | null {
	return getJobRun(db, id);
}

export function latestShippingJobRun(
	db: MaliniDatabase,
	workstreamId: string,
): JobRunRecord | null {
	return latestWorkstreamJobRun(db, workstreamId, shippingJobIds(db));
}

export function activeShippingJobRun(
	db: MaliniDatabase,
	workstreamId: string,
): JobRunRecord | null {
	return activeWorkstreamJobRun(db, workstreamId, shippingJobIds(db));
}

function shippingJobIds(db: MaliniDatabase): string[] {
	return listJobDefinitions(db)
		.filter(({ builtin }) => isShippingJobBuiltin(builtin))
		.map(({ id }) => id);
}
