import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JOBS_EXPERIMENT_CHANGED_CHANNEL } from '$contract/events';
import type { JobDefinitionRecord, JobExperimentRecord } from '$contract/jobs';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import type { JobsPlatform } from '../jobs.platform';
import { runAutomaticJob, type AutomaticJob } from './automatic-jobs.service';
import { registerJobs } from './register';

const NAMES: Readonly<Record<string, string>> = {
	haiku: 'Investigating failed deploy',
	sonnet: 'Deploy failure',
};

let db: MaliniDatabase;
let context: MainContext;
let jobs: JobsPlatform;
let finished: JobExperimentRecord[];
let calls: AutomaticJob[];

async function name(_task: string, job: AutomaticJob): Promise<string> {
	calls.push(job);
	const named = NAMES[job.model];
	if (named === undefined) throw new Error(`no name from ${job.model}`);
	return named;
}

beforeEach(() => {
	db = openMigratedDatabase(':memory:');
	const events = createEventBus({ forwardToWindows: false });
	finished = [];
	calls = [];
	events.subscribe(JOBS_EXPERIMENT_CHANGED_CHANNEL, ({ experiment }) => finished.push(experiment));
	context = {
		db,
		commands: new CommandRegistry(),
		events,
		appDataRoot: '/tmp/jobs-test',
		resourcesRoot: '/tmp/jobs-test',
		isDev: true,
		appVersion: '0.0.0-test',
	};
	jobs = registerJobs(context, { log: () => {}, suggestTitle: name });
});

afterEach(() => {
	jobs.dispose();
	db.close();
});

async function nameChats(): Promise<JobDefinitionRecord> {
	const definitions = await context.commands.call('jobs.list-definitions', undefined);
	const found = definitions.find((definition) => definition.builtin === 'name-chats');
	if (!found) throw new Error('missing Name chats');
	return found;
}

async function untilFinished(count: number): Promise<void> {
	for (let attempt = 0; attempt < 100 && finished.length < count; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

describe('job outputs and experiments', () => {
	it('records each name with its setup, replays a sample under a new setup, and uses the winner', async () => {
		const definition = await nameChats();
		expect(definition.model).toBe('haiku');
		await runAutomaticJob(db, 'name-chats', 'We just merged the site but it did not deploy', name);
		await expect(
			runAutomaticJob(db, 'name-chats', 'Second task', () =>
				Promise.reject(new Error('timed out')),
			),
		).rejects.toThrow('timed out');

		const since = new Date(Date.now() - 60_000).toISOString();
		const outputs = await context.commands.call('jobs.list-outputs', {
			definitionId: definition.id,
			since,
		});
		expect(outputs.map(({ output, error }) => [output, error])).toEqual([
			[null, 'timed out'],
			['Investigating failed deploy', null],
		]);
		const [setup] = await context.commands.call('jobs.list-setups', {
			definitionId: definition.id,
		});
		expect(setup).toMatchObject({ model: 'haiku', expectedRate: null });

		const opened = await context.commands.call('jobs.open-experiments', {
			definitionId: definition.id,
		});
		expect(opened.sample).toHaveLength(2);
		expect(opened.experiments.map(({ name: label, current }) => [label, current])).toEqual([
			['Today', true],
		]);

		const experiment = await context.commands.call('jobs.save-experiment', {
			definitionId: definition.id,
			provider: 'claude',
			model: 'sonnet',
			instructions: definition.instructions,
		});
		expect(experiment.name).toBe('Experiment 1');
		const running = await context.commands.call('jobs.run-experiment', {
			experimentId: experiment.id,
		});
		expect(running.running).toBe(true);
		await untilFinished(1);
		expect(finished[0]?.results.map(({ output }) => output)).toEqual([
			'Deploy failure',
			'Deploy failure',
		]);

		const used = await context.commands.call('jobs.use-experiment', {
			experimentId: experiment.id,
		});
		expect(used.model).toBe('sonnet');
		const setups = await context.commands.call('jobs.list-setups', {
			definitionId: definition.id,
		});
		expect(setups.map(({ model, expectedRate }) => [model, expectedRate])).toEqual([
			['haiku', null],
			['sonnet', 1],
		]);
		const reopened = await context.commands.call('jobs.open-experiments', {
			definitionId: definition.id,
		});
		expect(reopened.experiments.map(({ name: label, model }) => [label, model])).toEqual([
			['Today', 'sonnet'],
		]);

		await runAutomaticJob(db, 'name-chats', 'Third task', name);
		expect(
			(await context.commands.call('jobs.list-setups', { definitionId: definition.id })).length,
		).toBe(2);
	});

	it('keeps Today and refuses an experiment that has not run', async () => {
		const definition = await nameChats();
		await runAutomaticJob(db, 'name-chats', 'A task', name);
		const { experiments } = await context.commands.call('jobs.open-experiments', {
			definitionId: definition.id,
		});
		const today = experiments[0];
		if (!today) throw new Error('missing Today');
		await expect(
			context.commands.call('jobs.delete-experiment', { experimentId: today.id }),
		).rejects.toThrow('Today is what the job runs now');
		const draft = await context.commands.call('jobs.save-experiment', {
			definitionId: definition.id,
			provider: 'claude',
			model: 'sonnet',
			instructions: 'Name it.',
		});
		await expect(
			context.commands.call('jobs.use-experiment', { experimentId: draft.id }),
		).rejects.toThrow('Run Experiment 1 before you use it.');
		await expect(
			context.commands.call('jobs.save-experiment', {
				definitionId: definition.id,
				provider: 'claude',
				model: 'not a model!',
				instructions: 'Name it.',
			}),
		).rejects.toThrow('`model` must be a model id');
	});
});
