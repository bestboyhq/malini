import { randomUUID } from 'node:crypto';
import { JOBS_EXPERIMENT_CHANGED_CHANNEL } from '$contract/events';
import {
	isAutomaticJobBuiltin,
	type AutomaticJobBuiltin,
	type JobDefinitionRecord,
	type JobExperimentRecord,
	type JobExperimentResult,
	type JobExperimentsRecord,
	type JobSetupRecord,
} from '$contract/jobs';
import type { MainContext } from '$main/context';
import { nowIso8601 } from '$main/db/rows';
import { describeError } from '$main/errors';
import { followsEveryRule } from '../domain/job-output-checks';
import type { AutomaticJob } from './automatic-jobs.service';
import {
	clearJobExperimentResults,
	clearJobExperiments,
	deleteJobExperiment,
	getJobExperiment,
	insertJobExperiment,
	insertJobExperimentSample,
	listJobExperimentResults,
	listJobExperimentSample,
	listJobExperiments,
	saveJobExperimentResult,
	updateJobExperimentSetup,
	type StoredJobExperiment,
} from './job-experiments.repository';
import { getJobDefinition } from './job-definitions.repository';
import { insertJobSetup, jobOutputInput, recentJobOutputIds } from './job-outputs.repository';

export const JOB_EXPERIMENT_SAMPLE_SIZE = 12;

const CONCURRENT_REPLAYS = 3;
const CURRENT_EXPERIMENT_NAME = 'Today';
const EXPERIMENT_NAME = /^Experiment (\d+)$/u;

export type AutomaticJobDefinition = JobDefinitionRecord &
	Readonly<{ builtin: AutomaticJobBuiltin }>;

export type JobExperimentErrorKind = 'not-found' | 'locked' | 'busy' | 'not-ready';

export type ReplayWithJob = (
	builtin: AutomaticJobBuiltin,
	task: string,
	job: AutomaticJob,
) => Promise<string>;

export class JobExperimentError extends Error {
	readonly kind: JobExperimentErrorKind;

	constructor(kind: JobExperimentErrorKind, message: string) {
		super(message);
		this.name = 'JobExperimentError';
		this.kind = kind;
	}
}

export function isAutomaticJobDefinition(
	definition: JobDefinitionRecord,
): definition is AutomaticJobDefinition {
	return isAutomaticJobBuiltin(definition.builtin);
}

export class JobExperiments {
	readonly #context: MainContext;
	readonly #replay: ReplayWithJob;
	readonly #log: (line: string) => void;
	readonly #running = new Set<string>();
	readonly #waiting: (() => void)[] = [];
	#active = 0;

	constructor(context: MainContext, replay: ReplayWithJob, log: (line: string) => void) {
		this.#context = context;
		this.#replay = replay;
		this.#log = log;
	}

	open(definition: AutomaticJobDefinition): JobExperimentsRecord {
		const { db } = this.#context;
		if (listJobExperimentSample(db, definition.id).length === 0) {
			const sample = recentJobOutputIds(db, definition.id, JOB_EXPERIMENT_SAMPLE_SIZE);
			if (sample.length > 0) insertJobExperimentSample(db, definition.id, sample);
		}
		const current = listJobExperiments(db, definition.id).find((experiment) => experiment.current);
		if (!current) {
			insertJobExperiment(db, {
				id: randomUUID(),
				definitionId: definition.id,
				name: CURRENT_EXPERIMENT_NAME,
				model: definition.model,
				instructions: definition.instructions,
				current: true,
				createdAt: nowIso8601(),
			});
		} else if (!sameSetup(current, definition) && !this.#running.has(current.id)) {
			updateJobExperimentSetup(db, current.id, definition);
		}
		return {
			definitionId: definition.id,
			sample: listJobExperimentSample(db, definition.id),
			experiments: listJobExperiments(db, definition.id).map((experiment) =>
				this.#record(experiment),
			),
		};
	}

	save(
		definition: AutomaticJobDefinition,
		experimentId: string | null,
		setup: AutomaticJob,
	): JobExperimentRecord {
		const { db } = this.#context;
		if (experimentId !== null) {
			const existing = this.#editable(definition.id, experimentId);
			if (!sameSetup(existing, setup)) updateJobExperimentSetup(db, existing.id, setup);
			return this.#record(this.#require(existing.id));
		}
		const experiments = listJobExperiments(db, definition.id);
		const number =
			Math.max(0, ...experiments.map(({ name }) => Number(EXPERIMENT_NAME.exec(name)?.[1] ?? 0))) +
			1;
		const created: StoredJobExperiment = {
			id: randomUUID(),
			definitionId: definition.id,
			name: `Experiment ${number}`,
			model: setup.model,
			instructions: setup.instructions,
			current: false,
			createdAt: nowIso8601(),
		};
		insertJobExperiment(db, created);
		return this.#record(created);
	}

	delete(experimentId: string): void {
		const experiment = this.#require(experimentId);
		if (experiment.current) {
			throw new JobExperimentError('locked', 'Today is what the job runs now. It stays.');
		}
		this.#running.delete(experiment.id);
		deleteJobExperiment(this.#context.db, experiment.id);
	}

	run(experimentId: string): JobExperimentRecord {
		const experiment = this.#require(experimentId);
		if (!this.#running.has(experiment.id)) {
			this.#running.add(experiment.id);
			clearJobExperimentResults(this.#context.db, experiment.id);
			void this.#replayAll(experiment);
		}
		return this.#record(experiment);
	}

	prepareUse(experimentId: string): Readonly<{ definitionId: string; setup: JobSetupRecord }> {
		const experiment = this.#require(experimentId);
		if (experiment.current) {
			throw new JobExperimentError('locked', 'Today is already what the job runs.');
		}
		if (this.#running.has(experiment.id)) {
			throw new JobExperimentError('busy', `${experiment.name} is still running.`);
		}
		const { db } = this.#context;
		const sample = listJobExperimentSample(db, experiment.definitionId);
		const results = listJobExperimentResults(db, experiment.id);
		if (sample.length === 0 || results.length < sample.length) {
			throw new JobExperimentError('not-ready', `Run ${experiment.name} before you use it.`);
		}
		const builtin = automaticBuiltinOf(db, experiment.definitionId);
		const followed = results.filter((result) => followsEveryRule(builtin, result.output)).length;
		return {
			definitionId: experiment.definitionId,
			setup: {
				id: randomUUID(),
				model: experiment.model,
				instructions: experiment.instructions,
				expectedRate: followed / sample.length,
				createdAt: nowIso8601(),
			},
		};
	}

	finishUse(definitionId: string, setup: JobSetupRecord): void {
		const { db } = this.#context;
		for (const experiment of listJobExperiments(db, definitionId)) {
			this.#running.delete(experiment.id);
		}
		insertJobSetup(db, definitionId, setup);
		clearJobExperiments(db, definitionId);
	}

	#editable(definitionId: string, experimentId: string): StoredJobExperiment {
		const experiment = this.#require(experimentId);
		if (experiment.definitionId !== definitionId) {
			throw new JobExperimentError('not-found', `Experiment \`${experimentId}\` not found.`);
		}
		if (experiment.current) {
			throw new JobExperimentError(
				'locked',
				'Today is what the job runs now. Start an experiment to change it.',
			);
		}
		if (this.#running.has(experiment.id)) {
			throw new JobExperimentError('busy', `${experiment.name} is running. Wait for it to finish.`);
		}
		return experiment;
	}

	#require(experimentId: string): StoredJobExperiment {
		const experiment = getJobExperiment(this.#context.db, experimentId);
		if (!experiment) {
			throw new JobExperimentError('not-found', `Experiment \`${experimentId}\` not found.`);
		}
		return experiment;
	}

	#record(experiment: StoredJobExperiment): JobExperimentRecord {
		return {
			...experiment,
			running: this.#running.has(experiment.id),
			results: listJobExperimentResults(this.#context.db, experiment.id),
		};
	}

	async #replayAll(experiment: StoredJobExperiment): Promise<void> {
		const { db, events } = this.#context;
		const setup: AutomaticJob = { model: experiment.model, instructions: experiment.instructions };
		try {
			const builtin = automaticBuiltinOf(db, experiment.definitionId);
			const sample = listJobExperimentSample(db, experiment.definitionId);
			await Promise.all(
				sample.map((output) =>
					this.#slot(() => this.#replayOne(builtin, experiment.id, setup, output.id)),
				),
			);
		} catch (error) {
			this.#log(`jobs: ${experiment.name} stopped replaying: ${describeError(error)}`);
		} finally {
			this.#running.delete(experiment.id);
			const finished = getJobExperiment(db, experiment.id);
			if (finished) {
				events.emit(JOBS_EXPERIMENT_CHANGED_CHANNEL, { experiment: this.#record(finished) });
			}
		}
	}

	async #replayOne(
		builtin: AutomaticJobBuiltin,
		experimentId: string,
		setup: AutomaticJob,
		outputId: string,
	): Promise<void> {
		const { db } = this.#context;
		const input = jobOutputInput(db, outputId);
		if (input === null) return;
		let result: JobExperimentResult;
		try {
			result = { outputId, output: await this.#replay(builtin, input, setup), error: null };
		} catch (error) {
			result = { outputId, output: null, error: describeError(error) };
		}
		const experiment = getJobExperiment(db, experimentId);
		if (!experiment || !sameSetup(experiment, setup) || !this.#running.has(experimentId)) return;
		saveJobExperimentResult(db, experimentId, result, nowIso8601());
	}

	async #slot(work: () => Promise<void>): Promise<void> {
		while (this.#active >= CONCURRENT_REPLAYS) {
			await new Promise<void>((resolve) => this.#waiting.push(resolve));
		}
		this.#active += 1;
		try {
			await work();
		} finally {
			this.#active -= 1;
			this.#waiting.shift()?.();
		}
	}
}

function sameSetup(left: AutomaticJob, right: AutomaticJob): boolean {
	return left.model === right.model && left.instructions === right.instructions;
}

function automaticBuiltinOf(db: MainContext['db'], definitionId: string): AutomaticJobBuiltin {
	const definition = getJobDefinition(db, definitionId);
	if (definition && isAutomaticJobDefinition(definition)) return definition.builtin;
	throw new JobExperimentError('not-found', `Job \`${definitionId}\` takes no experiments.`);
}
