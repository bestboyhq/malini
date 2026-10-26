import { randomUUID } from 'node:crypto';
import type { AutomaticJobBuiltin } from '$contract/jobs';
import type { MaliniDatabase } from '$main/db/driver';
import { nowIso8601 } from '$main/db/rows';
import { describeError } from '$main/errors';
import { BUILTIN_JOBS } from '../domain/builtin-jobs';
import { getBuiltinJobDefinition } from './job-definitions.repository';
import { insertJobOutput, insertJobSetup, latestJobSetup } from './job-outputs.repository';

export const JOB_OUTPUT_INPUT_MAX_LENGTH = 4_000;

export type AutomaticJob = Readonly<{ instructions: string; model: string }>;

export type SuggestWithJob = (task: string, job: AutomaticJob) => Promise<string>;

export type ChooseWithJob = (task: string, job: AutomaticJob, choices: number) => Promise<number>;

type OutputResult = Readonly<{ output: string; error: null } | { output: null; error: string }>;

export async function runAutomaticJob(
	db: MaliniDatabase,
	builtin: AutomaticJobBuiltin,
	task: string,
	suggest: SuggestWithJob,
): Promise<string> {
	const definition = getBuiltinJobDefinition(db, builtin);
	const { instructions, model } = definition ?? BUILTIN_JOBS[builtin];
	const job: AutomaticJob = { instructions, model };
	const record = (result: OutputResult): void => {
		if (definition) recordJobOutput(db, definition.id, job, task, result);
	};
	try {
		const output = await suggest(task, job);
		record({ output, error: null });
		return output;
	} catch (error) {
		record({ output: null, error: describeError(error) });
		throw error;
	}
}

function recordJobOutput(
	db: MaliniDatabase,
	definitionId: string,
	job: AutomaticJob,
	task: string,
	result: OutputResult,
): void {
	try {
		db.transaction(() => {
			const createdAt = nowIso8601();
			const latest = latestJobSetup(db, definitionId);
			const reused =
				latest !== null && latest.model === job.model && latest.instructions === job.instructions
					? latest.id
					: null;
			const setupId = reused ?? randomUUID();
			if (reused === null) {
				insertJobSetup(db, definitionId, {
					id: setupId,
					model: job.model,
					instructions: job.instructions,
					expectedRate: null,
					createdAt,
				});
			}
			insertJobOutput(db, {
				id: randomUUID(),
				definitionId,
				setupId,
				input: task.slice(0, JOB_OUTPUT_INPUT_MAX_LENGTH),
				output: result.output,
				error: result.error,
				createdAt,
			});
		});
	} catch (error) {
		console.error(`jobs: could not record what ${definitionId} produced: ${describeError(error)}`);
	}
}
