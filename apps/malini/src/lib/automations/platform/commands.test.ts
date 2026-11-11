import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AutomationDefinitionRecord, AutomationTrigger } from '$contract/automations';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import type { AutomationsPlatform } from '../automations.platform';
import { updateAutomationDefinition } from './automation-definitions.repository';
import { registerAutomations } from './register';

const NEVER_REPORTED = 'on automations:run-finished where run.status is succeded';

let db: MaliniDatabase;
let context: MainContext;
let automations: AutomationsPlatform;

beforeEach(() => {
	db = openMigratedDatabase(':memory:');
	context = {
		db,
		commands: new CommandRegistry(),
		events: createEventBus({ forwardToWindows: false }),
		appDataRoot: '/tmp/automation-commands-test',
		checkoutsRoot: '/tmp/automation-commands-test',
		resourcesRoot: '/tmp/automation-commands-test',
		isDev: true,
		appVersion: '0.0.0-test',
	};
	automations = registerAutomations(context, { log: () => {} });
});

afterEach(() => {
	automations.dispose();
	db.close();
});

function save(trigger: AutomationTrigger, id?: string): Promise<AutomationDefinitionRecord> {
	return context.commands.call('automations.save-definition', {
		...(id === undefined ? {} : { id }),
		name: 'Note the release',
		instructions: 'Write a release note.',
		provider: 'claude',
		model: 'opus',
		effort: 'low',
		runsIn: 'workstream',
		trigger,
	});
}

describe('automations.save-definition', () => {
	it('refuses a trigger on a state its event never reports, naming the states it does', async () => {
		await expect(save({ when: NEVER_REPORTED, mode: 'auto' })).rejects.toMatchObject({
			kind: 'invalid-args',
			message: expect.stringContaining(
				'(automations:run-finished never reports run.status succeded. It reports succeeded, failed, or cancelled.)',
			),
		});
	});

	it('keeps a stored trigger on such a state: it lists and turns off, and a new one is refused', async () => {
		const saved = await save({
			when: 'on automations:run-finished where run.status is failed',
			mode: 'auto',
		});
		updateAutomationDefinition(db, { ...saved, trigger: { when: NEVER_REPORTED, mode: 'auto' } });

		const listed = await context.commands.call('automations.list-definitions', undefined);
		expect(listed.find(({ id }) => id === saved.id)?.trigger).toEqual({
			when: NEVER_REPORTED,
			mode: 'auto',
		});
		await expect(save({ when: NEVER_REPORTED, mode: 'off' }, saved.id)).resolves.toMatchObject({
			trigger: { when: NEVER_REPORTED, mode: 'off' },
		});
		await expect(
			save(
				{ when: 'on automations:run-finished where run.status is canceled', mode: 'off' },
				saved.id,
			),
		).rejects.toThrow(/never reports run\.status canceled/u);
	});
});
