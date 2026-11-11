import { randomUUID } from 'node:crypto';
import { AUTOMATIONS_EXPERIMENT_CHANGED_CHANNEL } from '$contract/events';
import {
	isOneShotAutomationBuiltin,
	type OneShotAutomationBuiltin,
	type AutomationDefinitionRecord,
	type AutomationExperimentRecord,
	type AutomationExperimentResult,
	type AutomationExperimentsRecord,
	type AutomationSetupRecord,
} from '$contract/automations';
import type { MainContext } from '$main/context';
import { nowIso8601 } from '$main/db/rows';
import { describeError } from '$main/errors';
import { followsEveryRule } from '../domain/automation-output-checks';
import type { OneShotAutomation } from './one-shot-automations.service';
import {
	clearAutomationExperimentResults,
	clearAutomationExperiments,
	deleteAutomationExperiment,
	getAutomationExperiment,
	insertAutomationExperiment,
	insertAutomationExperimentSample,
	listAutomationExperimentResults,
	listAutomationExperimentSample,
	listAutomationExperiments,
	saveAutomationExperimentResult,
	updateAutomationExperimentSetup,
	type StoredAutomationExperiment,
} from './automation-experiments.repository';
import { getAutomationDefinition } from './automation-definitions.repository';
import {
	insertAutomationSetup,
	automationOutputInput,
	recentAutomationOutputIds,
} from './automation-outputs.repository';
import { BackgroundWork } from './background-work';

export const AUTOMATION_EXPERIMENT_SAMPLE_SIZE = 12;

const CONCURRENT_REPLAYS = 3;
const CURRENT_EXPERIMENT_NAME = 'Today';
const EXPERIMENT_NAME = /^Experiment (\d+)$/u;

export type OneShotAutomationDefinition = AutomationDefinitionRecord &
	Readonly<{ builtin: OneShotAutomationBuiltin }>;

export type AutomationExperimentErrorKind = 'not-found' | 'locked' | 'busy' | 'not-ready';

export type ReplayWithAutomation = (
	builtin: OneShotAutomationBuiltin,
	task: string,
	automation: OneShotAutomation,
) => Promise<string>;

export class AutomationExperimentError extends Error {
	readonly kind: AutomationExperimentErrorKind;

	constructor(kind: AutomationExperimentErrorKind, message: string) {
		super(message);
		this.name = 'AutomationExperimentError';
		this.kind = kind;
	}
}

export function isOneShotAutomationDefinition(
	definition: AutomationDefinitionRecord,
): definition is OneShotAutomationDefinition {
	return isOneShotAutomationBuiltin(definition.builtin);
}

export class AutomationExperiments {
	readonly #context: MainContext;
	readonly #replay: ReplayWithAutomation;
	readonly #log: (line: string) => void;
	readonly #work: BackgroundWork;
	readonly #running = new Set<string>();
	readonly #waiting: (() => void)[] = [];
	#active = 0;

	constructor(
		context: MainContext,
		replay: ReplayWithAutomation,
		log: (line: string) => void,
		work = new BackgroundWork(log),
	) {
		this.#context = context;
		this.#replay = replay;
		this.#log = log;
		this.#work = work;
	}

	open(definition: OneShotAutomationDefinition): AutomationExperimentsRecord {
		const { db } = this.#context;
		if (listAutomationExperimentSample(db, definition.id).length === 0) {
			const sample = recentAutomationOutputIds(
				db,
				definition.id,
				AUTOMATION_EXPERIMENT_SAMPLE_SIZE,
			);
			if (sample.length > 0) insertAutomationExperimentSample(db, definition.id, sample);
		}
		const current = listAutomationExperiments(db, definition.id).find(
			(experiment) => experiment.current,
		);
		if (!current) {
			insertAutomationExperiment(db, {
				id: randomUUID(),
				definitionId: definition.id,
				name: CURRENT_EXPERIMENT_NAME,
				provider: definition.provider,
				model: definition.model,
				instructions: definition.instructions,
				current: true,
				createdAt: nowIso8601(),
			});
		} else if (!sameSetup(current, definition) && !this.#running.has(current.id)) {
			updateAutomationExperimentSetup(db, current.id, definition);
		}
		return {
			definitionId: definition.id,
			sample: listAutomationExperimentSample(db, definition.id),
			experiments: listAutomationExperiments(db, definition.id).map((experiment) =>
				this.#record(experiment),
			),
		};
	}

	save(
		definition: OneShotAutomationDefinition,
		experimentId: string | null,
		setup: OneShotAutomation,
	): AutomationExperimentRecord {
		const { db } = this.#context;
		if (experimentId !== null) {
			const existing = this.#editable(definition.id, experimentId);
			if (!sameSetup(existing, setup)) updateAutomationExperimentSetup(db, existing.id, setup);
			return this.#record(this.#require(existing.id));
		}
		const experiments = listAutomationExperiments(db, definition.id);
		const number =
			Math.max(0, ...experiments.map(({ name }) => Number(EXPERIMENT_NAME.exec(name)?.[1] ?? 0))) +
			1;
		const created: StoredAutomationExperiment = {
			id: randomUUID(),
			definitionId: definition.id,
			name: `Experiment ${number}`,
			provider: setup.provider,
			model: setup.model,
			instructions: setup.instructions,
			current: false,
			createdAt: nowIso8601(),
		};
		insertAutomationExperiment(db, created);
		return this.#record(created);
	}

	delete(experimentId: string): void {
		const experiment = this.#require(experimentId);
		if (experiment.current) {
			throw new AutomationExperimentError(
				'locked',
				'Today is what the automation runs now. It stays.',
			);
		}
		this.#running.delete(experiment.id);
		deleteAutomationExperiment(this.#context.db, experiment.id);
	}

	run(experimentId: string): AutomationExperimentRecord {
		const experiment = this.#require(experimentId);
		if (!this.#running.has(experiment.id)) {
			this.#running.add(experiment.id);
			clearAutomationExperimentResults(this.#context.db, experiment.id);
			this.#work.add(this.#replayAll(experiment));
		}
		return this.#record(experiment);
	}

	prepareUse(
		experimentId: string,
	): Readonly<{ definitionId: string; setup: AutomationSetupRecord }> {
		const experiment = this.#require(experimentId);
		if (experiment.current) {
			throw new AutomationExperimentError('locked', 'Today is already what the automation runs.');
		}
		if (this.#running.has(experiment.id)) {
			throw new AutomationExperimentError('busy', `${experiment.name} is still running.`);
		}
		const { db } = this.#context;
		const sample = listAutomationExperimentSample(db, experiment.definitionId);
		const results = listAutomationExperimentResults(db, experiment.id);
		if (sample.length === 0 || results.length < sample.length) {
			throw new AutomationExperimentError('not-ready', `Run ${experiment.name} before you use it.`);
		}
		const builtin = automaticBuiltinOf(db, experiment.definitionId);
		const followed = results.filter((result) => followsEveryRule(builtin, result.output)).length;
		return {
			definitionId: experiment.definitionId,
			setup: {
				id: randomUUID(),
				provider: experiment.provider,
				model: experiment.model,
				instructions: experiment.instructions,
				expectedRate: followed / sample.length,
				createdAt: nowIso8601(),
			},
		};
	}

	finishUse(definitionId: string, setup: AutomationSetupRecord): void {
		const { db } = this.#context;
		for (const experiment of listAutomationExperiments(db, definitionId)) {
			this.#running.delete(experiment.id);
		}
		insertAutomationSetup(db, definitionId, setup);
		clearAutomationExperiments(db, definitionId);
	}

	#editable(definitionId: string, experimentId: string): StoredAutomationExperiment {
		const experiment = this.#require(experimentId);
		if (experiment.definitionId !== definitionId) {
			throw new AutomationExperimentError('not-found', `Experiment \`${experimentId}\` not found.`);
		}
		if (experiment.current) {
			throw new AutomationExperimentError(
				'locked',
				'Today is what the automation runs now. Start an experiment to change it.',
			);
		}
		if (this.#running.has(experiment.id)) {
			throw new AutomationExperimentError(
				'busy',
				`${experiment.name} is running. Wait for it to finish.`,
			);
		}
		return experiment;
	}

	#require(experimentId: string): StoredAutomationExperiment {
		const experiment = getAutomationExperiment(this.#context.db, experimentId);
		if (!experiment) {
			throw new AutomationExperimentError('not-found', `Experiment \`${experimentId}\` not found.`);
		}
		return experiment;
	}

	#record(experiment: StoredAutomationExperiment): AutomationExperimentRecord {
		return {
			...experiment,
			running: this.#running.has(experiment.id),
			results: listAutomationExperimentResults(this.#context.db, experiment.id),
		};
	}

	async #replayAll(experiment: StoredAutomationExperiment): Promise<void> {
		const { db, events } = this.#context;
		const setup: OneShotAutomation = {
			provider: experiment.provider,
			model: experiment.model,
			instructions: experiment.instructions,
		};
		try {
			const builtin = automaticBuiltinOf(db, experiment.definitionId);
			const sample = listAutomationExperimentSample(db, experiment.definitionId);
			await Promise.all(
				sample.map((output) =>
					this.#slot(() => this.#replayOne(builtin, experiment.id, setup, output.id)),
				),
			);
		} catch (error) {
			this.#log(`automations: ${experiment.name} stopped replaying: ${describeError(error)}`);
		} finally {
			this.#running.delete(experiment.id);
			const finished = getAutomationExperiment(db, experiment.id);
			if (finished) {
				events.emit(AUTOMATIONS_EXPERIMENT_CHANGED_CHANNEL, { experiment: this.#record(finished) });
			}
		}
	}

	async #replayOne(
		builtin: OneShotAutomationBuiltin,
		experimentId: string,
		setup: OneShotAutomation,
		outputId: string,
	): Promise<void> {
		const { db } = this.#context;
		const input = this.#running.has(experimentId) ? automationOutputInput(db, outputId) : null;
		if (input === null) return;
		let result: AutomationExperimentResult;
		try {
			result = { outputId, output: await this.#replay(builtin, input, setup), error: null };
		} catch (error) {
			result = { outputId, output: null, error: describeError(error) };
		}
		const experiment = getAutomationExperiment(db, experimentId);
		if (!experiment || !sameSetup(experiment, setup) || !this.#running.has(experimentId)) return;
		saveAutomationExperimentResult(db, experimentId, result, nowIso8601());
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

function sameSetup(left: OneShotAutomation, right: OneShotAutomation): boolean {
	return (
		left.provider === right.provider &&
		left.model === right.model &&
		left.instructions === right.instructions
	);
}

function automaticBuiltinOf(db: MainContext['db'], definitionId: string): OneShotAutomationBuiltin {
	const definition = getAutomationDefinition(db, definitionId);
	if (definition && isOneShotAutomationDefinition(definition)) return definition.builtin;
	throw new AutomationExperimentError(
		'not-found',
		`Automation \`${definitionId}\` takes no experiments.`,
	);
}
