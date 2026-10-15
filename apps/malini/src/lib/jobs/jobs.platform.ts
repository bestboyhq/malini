import type { MaliniDatabase } from '$main/db/driver';
import { BUILTIN_JOBS } from './domain/builtin-jobs';
import { getBuiltinJobDefinition } from './platform/job-definitions.repository';

export interface JobsPlatform {
	start(): void;
	dispose(): void;
}

export type ChatNamingJob = Readonly<{ instructions: string; model: string }>;

export function chatNamingJob(db: MaliniDatabase): ChatNamingJob {
	const { instructions, model } =
		getBuiltinJobDefinition(db, 'name-chats') ?? BUILTIN_JOBS['name-chats'];
	return { instructions, model };
}
