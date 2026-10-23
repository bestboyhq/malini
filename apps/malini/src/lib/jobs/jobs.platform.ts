import type { AutomaticJobBuiltin, JobDefinitionRecord } from '$contract/jobs';
import type { MaliniDatabase } from '$main/db/driver';
import { BUILTIN_JOBS } from './domain/builtin-jobs';
import { getBuiltinJobDefinition, listJobDefinitions } from './platform/job-definitions.repository';

export { JOB_CONTEXT_MAX_BYTES } from './domain/job-run';

export interface JobsPlatform {
	start(): void;
	dispose(): void;
}

export type AutomaticJob = Readonly<{ instructions: string; model: string }>;

export function chatNamingJob(db: MaliniDatabase): AutomaticJob {
	return automaticJob(db, 'name-chats');
}

export function serviceNamingJob(db: MaliniDatabase): AutomaticJob {
	return automaticJob(db, 'name-services');
}

function automaticJob(db: MaliniDatabase, builtin: AutomaticJobBuiltin): AutomaticJob {
	const { instructions, model } = getBuiltinJobDefinition(db, builtin) ?? BUILTIN_JOBS[builtin];
	return { instructions, model };
}

export function jobDefinitions(db: MaliniDatabase): JobDefinitionRecord[] {
	return listJobDefinitions(db);
}
