import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { JOBS_DEFINITION_CHANGED_CHANNEL } from '$contract/events';
import type {
	JobBuiltin,
	JobDefinitionChangedEvent,
	JobDefinitionRecord,
	JobRunOrigin,
	JobRunRecord,
} from '$contract/jobs';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { isRecord, nowIso8601 } from '$main/db/rows';
import { isValidAgentModel } from '$shared/providers/providers.platform';
import {
	getWorkstream,
	resolveConnectedRepository,
} from '$shared/repositories/repositories.platform';
import { BUILTIN_JOBS, BUILTIN_JOB_KEYS, isRunnableJob } from '../domain/builtin-jobs';
import {
	JOB_INSTRUCTIONS_MAX_LENGTH,
	JOB_NAME_MAX_LENGTH,
	isJobEffort,
	isJobOutput,
	isJobRunsIn,
} from '../domain/job-definition';
import { JOB_CONTEXT_MAX_BYTES, isFinishedJobRunStatus, isJobRunOrigin } from '../domain/job-run';
import {
	deleteJobDefinition,
	getJobDefinition,
	insertJobDefinition,
	listJobDefinitions,
	updateJobDefinition,
} from './job-definitions.repository';
import {
	countUnfinishedJobRuns,
	getJobRun,
	listChatJobRuns,
	listRecentFinishedJobRuns,
	listUnfinishedJobRuns,
} from './job-runs.repository';
import type { JobRunner } from './job-runner.service';

const RECENT_FINISHED_RUNS = 30;

export type JobErrorKind = 'invalid-args' | 'not-found' | 'builtin' | 'not-builtin' | 'busy';

export class JobError extends Error {
	readonly kind: JobErrorKind;

	constructor(kind: JobErrorKind, message: string) {
		super(message);
		this.name = 'JobError';
		this.kind = kind;
	}
}

type JobDefinitionFields = Pick<
	JobDefinitionRecord,
	'name' | 'instructions' | 'model' | 'effort' | 'runsIn' | 'output' | 'skillPresetId'
>;

export function seedBuiltinJobs(db: MaliniDatabase): void {
	const now = nowIso8601();
	for (const builtin of BUILTIN_JOB_KEYS) {
		insertJobDefinition(db, {
			id: randomUUID(),
			...builtinDefaults(builtin),
			skillPresetId: null,
			builtin,
			createdAt: now,
			updatedAt: now,
		});
	}
}

export function defineJobCommands(context: MainContext, runner: JobRunner): void {
	const { db, commands, events } = context;

	const definitionChanged = (
		definitionId: string,
		definition: JobDefinitionRecord | null,
	): void => {
		const payload: JobDefinitionChangedEvent = { definitionId, definition };
		events.emit(JOBS_DEFINITION_CHANGED_CHANNEL, payload);
	};

	commands.define('jobs.list-definitions', () => listJobDefinitions(db));

	commands.define('jobs.save-definition', (args: unknown) => {
		const id = optionalString(args, 'id');
		const fields = definitionFields(args);
		const now = nowIso8601();
		if (id === null) {
			const created: JobDefinitionRecord = {
				id: randomUUID(),
				...fields,
				builtin: null,
				createdAt: now,
				updatedAt: now,
			};
			insertJobDefinition(db, created);
			definitionChanged(created.id, created);
			return created;
		}
		const existing = requireDefinition(db, id);
		const saved: JobDefinitionRecord = {
			...existing,
			...fields,
			runsIn: existing.builtin ? existing.runsIn : fields.runsIn,
			output: existing.builtin ? existing.output : fields.output,
			updatedAt: now,
		};
		updateJobDefinition(db, saved);
		definitionChanged(saved.id, saved);
		return saved;
	});

	commands.define('jobs.delete-definition', (args: unknown) => {
		const definition = requireDefinition(db, requireString(args, 'definitionId'));
		if (definition.builtin) {
			throw new JobError('builtin', `${definition.name} is built in. Reset it instead.`);
		}
		if (countUnfinishedJobRuns(db, definition.id) > 0) {
			throw new JobError('busy', `${definition.name} is queued or running. Cancel it first.`);
		}
		deleteJobDefinition(db, definition.id);
		definitionChanged(definition.id, null);
		return null;
	});

	commands.define('jobs.reset-definition', (args: unknown) => {
		const definition = requireDefinition(db, requireString(args, 'definitionId'));
		const builtin: JobBuiltin | null = definition.builtin;
		if (builtin === null) throw new JobError('not-builtin', 'Only a built-in job can be reset.');
		const reset: JobDefinitionRecord = {
			...definition,
			...builtinDefaults(builtin),
			skillPresetId: null,
			updatedAt: nowIso8601(),
		};
		updateJobDefinition(db, reset);
		definitionChanged(reset.id, reset);
		return reset;
	});

	commands.define('jobs.list-runs', () =>
		[...listUnfinishedJobRuns(db), ...listRecentFinishedJobRuns(db, RECENT_FINISHED_RUNS)].sort(
			(left, right) => right.createdAt.localeCompare(left.createdAt),
		),
	);

	commands.define('jobs.list-chat-runs', (args: unknown) =>
		listChatJobRuns(db, requireString(args, 'chatSessionId')),
	);

	commands.define('jobs.run', async (args: unknown) => {
		const definition = requireDefinition(db, requireString(args, 'definitionId'));
		if (!isRunnableJob(definition)) {
			throw new JobError(
				'builtin',
				`${definition.name} runs on its own when you send the first message in a chat.`,
			);
		}
		const workstreamId = optionalString(args, 'workstreamId');
		const repositoryId = optionalString(args, 'repositoryId');
		const jobContext = optionalContext(args);
		const origin = optionalOrigin(args);
		const chatSessionId = optionalString(args, 'chatSessionId');
		const chatAfterRunId = chatSessionId === null ? null : optionalString(args, 'chatAfterRunId');
		const target =
			definition.runsIn === 'workstream'
				? { workstreamId: requireWorkstream(db, workstreamId), repositoryId: null }
				: {
						workstreamId: null,
						repositoryId: await requireRepository(
							db,
							repositoryId ?? repositoryOfWorkstream(db, workstreamId),
						),
					};
		const queued: JobRunRecord = {
			id: randomUUID(),
			definitionId: definition.id,
			title: definition.name,
			...target,
			sessionId: null,
			agentRunId: null,
			origin,
			status: 'queued',
			detail: null,
			chatSessionId,
			chatAfterRunId,
			createdAt: nowIso8601(),
			startedAt: null,
			finishedAt: null,
		};
		return runner.enqueue(queued, jobContext);
	});

	commands.define('jobs.cancel-run', (args: unknown) => {
		const jobRunId = requireString(args, 'jobRunId');
		const jobRun = getJobRun(db, jobRunId);
		if (!jobRun) throw new JobError('not-found', `Job run \`${jobRunId}\` not found.`);
		return isFinishedJobRunStatus(jobRun.status) ? jobRun : runner.cancel(jobRun);
	});
}

function builtinDefaults(
	builtin: JobBuiltin,
): Pick<JobDefinitionRecord, 'name' | 'instructions' | 'model' | 'effort' | 'runsIn' | 'output'> {
	const { runsIn = 'workstream', output = 'none', ...defaults } = BUILTIN_JOBS[builtin];
	return { ...defaults, runsIn, output };
}

function definitionFields(args: unknown): JobDefinitionFields {
	const name = requireString(args, 'name').trim();
	if (name.length === 0 || name.length > JOB_NAME_MAX_LENGTH) {
		throw invalid(`\`name\` must be 1 to ${JOB_NAME_MAX_LENGTH} characters`);
	}
	const instructions = requireString(args, 'instructions').trim();
	if (instructions.length === 0 || instructions.length > JOB_INSTRUCTIONS_MAX_LENGTH) {
		throw invalid(`\`instructions\` must be 1 to ${JOB_INSTRUCTIONS_MAX_LENGTH} characters`);
	}
	const model = field(args, 'model');
	if (!isValidAgentModel(model)) throw invalid('`model` must be a model id');
	const effort = field(args, 'effort');
	if (!isJobEffort(effort)) throw invalid('`effort` must be low, medium, high, xhigh or max');
	const runsIn = field(args, 'runsIn');
	if (!isJobRunsIn(runsIn)) throw invalid('`runsIn` must be workstream or new-workstream');
	const output = field(args, 'output');
	if (!isJobOutput(output)) throw invalid('`output` must be none, draft or merge');
	const skillPresetId = optionalString(args, 'skillPresetId');
	return { name, instructions, model, effort, runsIn, output, skillPresetId };
}

function requireDefinition(db: MaliniDatabase, definitionId: string): JobDefinitionRecord {
	const definition = getJobDefinition(db, definitionId);
	if (!definition) throw new JobError('not-found', `Job \`${definitionId}\` not found.`);
	return definition;
}

function requireWorkstream(db: MaliniDatabase, workstreamId: string | null): string {
	if (workstreamId === null) throw invalid('`workstreamId` is required for this job');
	if (!getWorkstream(db, workstreamId)) {
		throw new JobError('not-found', `Workstream \`${workstreamId}\` not found.`);
	}
	return workstreamId;
}

function repositoryOfWorkstream(db: MaliniDatabase, workstreamId: string | null): string | null {
	return workstreamId === null ? null : (getWorkstream(db, workstreamId)?.projectId ?? null);
}

async function requireRepository(db: MaliniDatabase, repositoryId: string | null): Promise<string> {
	if (repositoryId === null) throw invalid('`repositoryId` is required for this job');
	if (!(await resolveConnectedRepository(db, repositoryId))) {
		throw new JobError('not-found', `Repository \`${repositoryId}\` not found.`);
	}
	return repositoryId;
}

function optionalContext(args: unknown): string | null {
	const value = field(args, 'context');
	if (value === undefined || value === null || value === '') return null;
	if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > JOB_CONTEXT_MAX_BYTES) {
		throw invalid(`\`context\` must be a string of at most ${JOB_CONTEXT_MAX_BYTES} bytes`);
	}
	return value;
}

function optionalOrigin(args: unknown): JobRunOrigin {
	const value = field(args, 'origin');
	if (value === undefined || value === null) return 'manual';
	if (!isJobRunOrigin(value)) throw invalid('`origin` must be merge-queue, manual or routine');
	return value;
}

function field(args: unknown, key: string): unknown {
	return isRecord(args) ? args[key] : undefined;
}

function requireString(args: unknown, key: string): string {
	const value = field(args, key);
	if (typeof value !== 'string') throw invalid(`\`${key}\` must be a string`);
	return value;
}

function optionalString(args: unknown, key: string): string | null {
	const value = field(args, key);
	if (value === undefined || value === null) return null;
	if (typeof value !== 'string' || value.length === 0) {
		throw invalid(`\`${key}\` must be a non-empty string when present`);
	}
	return value;
}

function invalid(message: string): JobError {
	return new JobError('invalid-args', `invalid args: ${message}`);
}
