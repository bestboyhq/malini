import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOMATIONS_EXPERIMENT_CHANGED_CHANNEL } from '$contract/events';
import type { AutomationDefinitionRecord, AutomationExperimentRecord } from '$contract/automations';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import type { AutomationsPlatform } from '../automations.platform';
import { runOneShotAutomation, type OneShotAutomation } from './one-shot-automations.service';
import { registerAutomations } from './register';

const NAMES: Readonly<Record<string, string>> = {
	haiku: 'Investigating failed deploy',
	sonnet: 'Deploy failure',
};

let db: MaliniDatabase;
let context: MainContext;
let automations: AutomationsPlatform;
let finished: AutomationExperimentRecord[];
let calls: OneShotAutomation[];
let held: Promise<void> | null;

const HELD = 'Take your time naming it.';

async function name(_task: string, automation: OneShotAutomation): Promise<string> {
	calls.push(automation);
	if (automation.instructions === HELD) await held;
	const named = NAMES[automation.model];
	if (named === undefined) throw new Error(`no name from ${automation.model}`);
	return named;
}

beforeEach(() => {
	db = openMigratedDatabase(':memory:');
	const events = createEventBus({ forwardToWindows: false });
	finished = [];
	calls = [];
	held = null;
	events.subscribe(AUTOMATIONS_EXPERIMENT_CHANGED_CHANNEL, ({ experiment }) =>
		finished.push(experiment),
	);
	context = {
		db,
		commands: new CommandRegistry(),
		events,
		appDataRoot: '/tmp/automations-test',
		checkoutsRoot: '/tmp/automations-test',
		resourcesRoot: '/tmp/automations-test',
		isDev: true,
		appVersion: '0.0.0-test',
	};
	automations = registerAutomations(context, { log: () => {}, suggestTitle: name });
});

afterEach(() => {
	automations.dispose();
	db.close();
});

async function nameChats(): Promise<AutomationDefinitionRecord> {
	const definitions = await context.commands.call('automations.list-definitions', undefined);
	const found = definitions.find((definition) => definition.builtin === 'name-chats');
	if (!found) throw new Error('missing Name chats');
	return found;
}

async function untilFinished(count: number): Promise<void> {
	for (let attempt = 0; attempt < 100 && finished.length < count; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

describe('automation outputs and experiments', () => {
	it('records each name with its setup, replays a sample under a new setup, and uses the winner', async () => {
		const definition = await nameChats();
		expect(definition.model).toBe('haiku');
		await runOneShotAutomation(
			db,
			'name-chats',
			'We just merged the site but it did not deploy',
			name,
		);
		await expect(
			runOneShotAutomation(db, 'name-chats', 'Second task', () =>
				Promise.reject(new Error('timed out')),
			),
		).rejects.toThrow('timed out');

		const since = new Date(Date.now() - 60_000).toISOString();
		const outputs = await context.commands.call('automations.list-outputs', {
			definitionId: definition.id,
			since,
		});
		expect(outputs.map(({ output, error }) => [output, error])).toEqual([
			[null, 'timed out'],
			['Investigating failed deploy', null],
		]);
		const [setup] = await context.commands.call('automations.list-setups', {
			definitionId: definition.id,
		});
		expect(setup).toMatchObject({ model: 'haiku', expectedRate: null });

		const opened = await context.commands.call('automations.open-experiments', {
			definitionId: definition.id,
		});
		expect(opened.sample).toHaveLength(2);
		expect(opened.experiments.map(({ name: label, current }) => [label, current])).toEqual([
			['Today', true],
		]);

		const experiment = await context.commands.call('automations.save-experiment', {
			definitionId: definition.id,
			provider: 'claude',
			model: 'sonnet',
			instructions: definition.instructions,
		});
		expect(experiment.name).toBe('Experiment 1');
		const running = await context.commands.call('automations.run-experiment', {
			experimentId: experiment.id,
		});
		expect(running.running).toBe(true);
		await untilFinished(1);
		expect(finished[0]?.results.map(({ output }) => output)).toEqual([
			'Deploy failure',
			'Deploy failure',
		]);

		const used = await context.commands.call('automations.use-experiment', {
			experimentId: experiment.id,
		});
		expect(used.model).toBe('sonnet');
		const setups = await context.commands.call('automations.list-setups', {
			definitionId: definition.id,
		});
		expect(setups.map(({ model, expectedRate }) => [model, expectedRate])).toEqual([
			['haiku', null],
			['sonnet', 1],
		]);
		const reopened = await context.commands.call('automations.open-experiments', {
			definitionId: definition.id,
		});
		expect(reopened.experiments.map(({ name: label, model }) => [label, model])).toEqual([
			['Today', 'sonnet'],
		]);

		await runOneShotAutomation(db, 'name-chats', 'Third task', name);
		expect(
			(await context.commands.call('automations.list-setups', { definitionId: definition.id }))
				.length,
		).toBe(2);
	});

	it('stops the replays an experiment still has queued once you use another one', async () => {
		const definition = await nameChats();
		for (const task of ['One', 'Two', 'Three', 'Four', 'Five']) {
			await runOneShotAutomation(db, 'name-chats', task, name);
		}
		await context.commands.call('automations.open-experiments', { definitionId: definition.id });
		const save = (instructions: string) =>
			context.commands.call('automations.save-experiment', {
				definitionId: definition.id,
				provider: 'claude',
				model: 'sonnet',
				instructions,
			});
		const winner = await save('Name it.');
		const slow = await save(HELD);
		await context.commands.call('automations.run-experiment', { experimentId: winner.id });
		await untilFinished(1);
		let release = (): void => {};
		held = new Promise((resolve) => (release = resolve));
		const slowCalls = () => calls.filter(({ instructions }) => instructions === HELD).length;

		await context.commands.call('automations.run-experiment', { experimentId: slow.id });
		await vi.waitFor(() => expect(slowCalls()).toBe(3));
		await context.commands.call('automations.use-experiment', { experimentId: winner.id });
		release();
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(slowCalls()).toBe(3);
	});

	it('keeps Today and refuses an experiment that has not run', async () => {
		const definition = await nameChats();
		await runOneShotAutomation(db, 'name-chats', 'A task', name);
		const { experiments } = await context.commands.call('automations.open-experiments', {
			definitionId: definition.id,
		});
		const today = experiments[0];
		if (!today) throw new Error('missing Today');
		await expect(
			context.commands.call('automations.delete-experiment', { experimentId: today.id }),
		).rejects.toThrow('Today is what the automation runs now');
		const draft = await context.commands.call('automations.save-experiment', {
			definitionId: definition.id,
			provider: 'claude',
			model: 'sonnet',
			instructions: 'Name it.',
		});
		await expect(
			context.commands.call('automations.use-experiment', { experimentId: draft.id }),
		).rejects.toThrow('Run Experiment 1 before you use it.');
		await expect(
			context.commands.call('automations.save-experiment', {
				definitionId: definition.id,
				provider: 'claude',
				model: 'not a model!',
				instructions: 'Name it.',
			}),
		).rejects.toThrow('`model` must be a model id');
	});
});
