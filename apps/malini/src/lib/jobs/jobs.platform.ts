import type { JobDefinitionRecord, JobRunRecord } from '$contract/jobs';
import type { MaliniDatabase } from '$main/db/driver';
import { listJobDefinitions } from './platform/job-definitions.repository';
import { findActiveJobRunForSession } from './platform/job-runs.repository';

export { JOB_CONTEXT_MAX_BYTES } from './domain/job-run';
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
