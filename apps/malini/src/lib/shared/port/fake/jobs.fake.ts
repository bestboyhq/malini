import {
	isAutomaticJobBuiltin,
	type JobBuiltin,
	type JobDefinitionRecord,
	type JobRunRecord,
} from '$contract/jobs';
import type { FakeBridge } from './fake-bridge';

const FAKE_JOB_TIME = '2026-01-01T00:00:00.000Z';

const fakeRuns = new WeakMap<FakeBridge, Map<string, JobRunRecord>>();

export type FakeJobRunPatch = Partial<
	Pick<
		JobRunRecord,
		'status' | 'sessionId' | 'agentRunId' | 'workstreamId' | 'detail' | 'startedAt' | 'finishedAt'
	>
>;

export function seedFakeJobRun(bridge: FakeBridge, run: JobRunRecord): void {
	fakeRunsOf(bridge).set(run.id, run);
}

export function updateFakeJobRun(
	bridge: FakeBridge,
	jobRunId: string,
	patch: FakeJobRunPatch,
): JobRunRecord {
	const runs = fakeRunsOf(bridge);
	const run = runs.get(jobRunId);
	if (!run) throw new Error(`Unknown fake job run: ${jobRunId}`);
	const updated: JobRunRecord = { ...run, ...patch };
	runs.set(updated.id, updated);
	bridge.emit('jobs:run-changed', { run: updated });
	return updated;
}

function fakeRunsOf(bridge: FakeBridge): Map<string, JobRunRecord> {
	const runs = fakeRuns.get(bridge);
	if (!runs) throw new Error('the jobs fake is not installed on this bridge');
	return runs;
}

const FAKE_BUILTINS: readonly (readonly [JobBuiltin, string])[] = [
	['name-chats', 'Name chats'],
	['suggest-presets', 'Suggest skill presets'],
	['fix-checks', 'Fix checks'],
	['update-from-main', 'Update from main'],
	['address-review', 'Address bot review'],
];

export function installJobsFake(bridge: FakeBridge): void {
	const definitions = new Map<string, JobDefinitionRecord>();
	const runs = new Map<string, JobRunRecord>();
	fakeRuns.set(bridge, runs);
	let nextDefinition = 1;
	let nextRun = 1;

	const seedBuiltins = (): void => {
		for (const [builtin, name] of FAKE_BUILTINS) {
			const id = `fake-job-${builtin}`;
			definitions.set(id, {
				id,
				name,
				instructions: `${name} in this workstream.`,
				model: 'opus',
				effort: 'medium',
				runsIn: 'workstream',
				output: 'none',
				skillPresetId: null,
				builtin,
				createdAt: FAKE_JOB_TIME,
				updatedAt: FAKE_JOB_TIME,
			});
		}
	};
	seedBuiltins();

	bridge.onReset(() => {
		definitions.clear();
		runs.clear();
		nextDefinition = 1;
		nextRun = 1;
		seedBuiltins();
	});

	bridge.define('jobs.list-definitions', async () => [...definitions.values()]);

	bridge.define('jobs.save-definition', async (input) => {
		const existing = input.id ? definitions.get(input.id) : undefined;
		const id = existing?.id ?? `fake-job-${nextDefinition++}`;
		const definition: JobDefinitionRecord = {
			id,
			name: input.name,
			instructions: input.instructions,
			model: input.model,
			effort: input.effort,
			runsIn: existing?.builtin ? 'workstream' : input.runsIn,
			output: existing?.builtin ? 'none' : input.output,
			skillPresetId: input.skillPresetId ?? null,
			builtin: existing?.builtin ?? null,
			createdAt: existing?.createdAt ?? FAKE_JOB_TIME,
			updatedAt: FAKE_JOB_TIME,
		};
		definitions.set(id, definition);
		bridge.emit('jobs:definition-changed', { definitionId: id, definition });
		return definition;
	});

	bridge.define('jobs.delete-definition', async (input) => {
		const definition = requireDefinition(definitions, input.definitionId);
		if (definition.builtin) throw new Error('A built-in job cannot be deleted');
		definitions.delete(definition.id);
		bridge.emit('jobs:definition-changed', { definitionId: definition.id, definition: null });
		return null;
	});

	bridge.define('jobs.reset-definition', async (input) => {
		const definition = requireDefinition(definitions, input.definitionId);
		const builtin = FAKE_BUILTINS.find(([key]) => key === definition.builtin);
		if (!builtin) throw new Error('Only a built-in job can be reset');
		const reset: JobDefinitionRecord = {
			...definition,
			name: builtin[1],
			instructions: `${builtin[1]} in this workstream.`,
			model: 'opus',
			effort: 'medium',
			updatedAt: FAKE_JOB_TIME,
		};
		definitions.set(reset.id, reset);
		bridge.emit('jobs:definition-changed', { definitionId: reset.id, definition: reset });
		return reset;
	});

	bridge.define('jobs.list-runs', async () =>
		[...runs.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
	);

	bridge.define('jobs.list-chat-runs', async (input) =>
		[...runs.values()]
			.filter((run) => run.chatSessionId === input.chatSessionId)
			.sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
	);

	bridge.define('jobs.run', async (input) => {
		const definition = requireDefinition(definitions, input.definitionId);
		if (isAutomaticJobBuiltin(definition.builtin)) {
			throw new Error(`${definition.name} runs on its own`);
		}
		const run: JobRunRecord = {
			id: `fake-job-run-${nextRun++}`,
			definitionId: definition.id,
			title: definition.name,
			workstreamId: input.workstreamId ?? null,
			repositoryId: input.repositoryId ?? null,
			sessionId: null,
			agentRunId: null,
			origin: input.origin ?? 'manual',
			status: 'queued',
			detail: null,
			chatSessionId: input.chatSessionId ?? null,
			chatAfterRunId: input.chatAfterRunId ?? null,
			createdAt: new Date(Date.parse(FAKE_JOB_TIME) + nextRun * 1_000).toISOString(),
			startedAt: null,
			finishedAt: null,
		};
		runs.set(run.id, run);
		bridge.emit('jobs:run-changed', { run });
		return run;
	});

	bridge.define('jobs.cancel-run', async (input) => {
		const run = runs.get(input.jobRunId);
		if (!run) throw new Error(`Unknown fake job run: ${input.jobRunId}`);
		const cancelled: JobRunRecord = {
			...run,
			status: 'cancelled',
			finishedAt: new Date().toISOString(),
		};
		runs.set(cancelled.id, cancelled);
		bridge.emit('jobs:run-changed', { run: cancelled });
		return cancelled;
	});
}

function requireDefinition(
	definitions: ReadonlyMap<string, JobDefinitionRecord>,
	definitionId: string,
): JobDefinitionRecord {
	const definition = definitions.get(definitionId);
	if (!definition) throw new Error(`Unknown fake job definition: ${definitionId}`);
	return definition;
}
