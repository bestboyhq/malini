import type { JobDefinitionRecord, JobRunOrigin, JobRunRecord } from '$contract/jobs';
import type { MaliniDatabase } from '$main/db/driver';
import { getJobDefinition, listJobDefinitions } from './platform/job-definitions.repository';
import {
	findActiveChildJobRun,
	findActiveJobRunForSession,
	getJobRun,
	latestWorkstreamJobRun,
} from './platform/job-runs.repository';

export { JOB_CONTEXT_MAX_BYTES } from './domain/job-run';
export { clearAlarm, setAlarm } from './platform/alarms.repository';
export { latestLoggedEvent } from './platform/event-log.repository';
export type { DispatchedEvent } from './platform/event-log.service';
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

export function jobDefinitions(db: MaliniDatabase): JobDefinitionRecord[] {
	return listJobDefinitions(db);
}

export function activeJobRunForSession(db: MaliniDatabase, sessionId: string): JobRunRecord | null {
	return findActiveJobRunForSession(db, sessionId);
}

export function jobDefinition(db: MaliniDatabase, id: string): JobDefinitionRecord | null {
	return getJobDefinition(db, id);
}

export function jobRun(db: MaliniDatabase, id: string): JobRunRecord | null {
	return getJobRun(db, id);
}

export function latestJobRunInWorkstream(
	db: MaliniDatabase,
	workstreamId: string,
	origin: JobRunOrigin,
): JobRunRecord | null {
	return latestWorkstreamJobRun(db, workstreamId, origin);
}

export function activeThenJobRun(db: MaliniDatabase, parentRunId: string): JobRunRecord | null {
	return findActiveChildJobRun(db, parentRunId);
}
