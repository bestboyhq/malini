import { isShippingJobBuiltin, type JobDefinitionRecord, type JobRunRecord } from '$contract/jobs';
import type { MaliniDatabase } from '$main/db/driver';
import { getJobDefinition, listJobDefinitions } from './platform/job-definitions.repository';
import {
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

export function latestShippingJobRun(
	db: MaliniDatabase,
	workstreamId: string,
): JobRunRecord | null {
	const shippingJobs = listJobDefinitions(db)
		.filter(({ builtin }) => isShippingJobBuiltin(builtin))
		.map(({ id }) => id);
	return latestWorkstreamJobRun(db, workstreamId, 'merge-queue', shippingJobs);
}
