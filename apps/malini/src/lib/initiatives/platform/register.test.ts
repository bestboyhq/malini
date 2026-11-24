import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandName } from '$contract/commands';
import { REPOSITORY_FULL_NAME_MAX_LENGTH } from '$contract/scratchpad';
import type { MainContext } from '$main/context';
import { openMigratedDatabase } from '$main/db/open';
import { scalar } from '$main/db/rows';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import { registerInitiatives } from './register';

let context: MainContext;

beforeEach(() => {
	context = {
		db: openMigratedDatabase(':memory:'),
		commands: new CommandRegistry(),
		events: createEventBus({ forwardToWindows: false }),
		appDataRoot: '/tmp/malini',
		checkoutsRoot: '/tmp/malini',
		resourcesRoot: '/tmp/malini',
		isDev: false,
		appVersion: '0.0.0',
	};
	registerInitiatives(context, { gh: () => Promise.reject(new Error('no gh here')) });
});

afterEach(() => context.db.close());

function rows(table: string): number {
	return scalar(context.db, `SELECT COUNT(*) FROM ${table}`);
}

describe('initiatives', () => {
	it('keeps dated outcomes first, steps in order, ticks and one link per workstream', async () => {
		await context.commands.call('initiatives.create', {
			repositoryFullName: 'bestboyhq/grip',
			title: 'Someday',
			dueOn: null,
		});
		const created = await context.commands.call('initiatives.create', {
			repositoryFullName: '  bestboyhq/malini  ',
			title: '  Ship billing  ',
			dueOn: '2026-12-01',
		});
		expect(
			created.map(({ repositoryFullName, title, dueOn }) => ({ repositoryFullName, title, dueOn })),
		).toEqual([
			{ repositoryFullName: 'bestboyhq/malini', title: 'Ship billing', dueOn: '2026-12-01' },
			{ repositoryFullName: 'bestboyhq/grip', title: 'Someday', dueOn: null },
		]);
		expect(await context.commands.call('initiatives.list', undefined)).toEqual(created);

		const initiativeId = created[0]?.id ?? '';
		await context.commands.call('initiatives.add-dependency', { initiativeId, title: 'Schema' });
		const planned = await context.commands.call('initiatives.add-dependency', {
			initiativeId,
			title: 'Checkout page',
		});
		const steps = planned[0]?.dependencies ?? [];
		expect(steps.map(({ title }) => title)).toEqual(['Schema', 'Checkout page']);

		const dependencyId = steps[1]?.id ?? '';
		await context.commands.call('initiatives.update-dependency', { id: dependencyId, done: true });
		const link = { dependencyId, workstreamId: 'ws-checkout' };
		await context.commands.call('initiatives.link-workstream', link);
		const linked = await context.commands.call('initiatives.link-workstream', link);
		expect(linked[0]?.dependencies[1]).toEqual({
			id: dependencyId,
			title: 'Checkout page',
			done: true,
			note: null,
			workstreams: [{ workstreamId: 'ws-checkout', needs: null }],
			assignee: null,
		});

		const note = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });
		await context.commands.call('initiatives.update', { id: initiativeId, note });
		const noted = await context.commands.call('initiatives.update-dependency', {
			id: dependencyId,
			note,
		});
		expect([noted[0]?.note, noted[0]?.dependencies[1]?.note]).toEqual([note, note]);
		const renamed = await context.commands.call('initiatives.update', {
			id: initiativeId,
			title: 'Ship billing soon',
		});
		expect(renamed[0]?.note).toBe(note);
		const cleared = await context.commands.call('initiatives.update', {
			id: initiativeId,
			note: null,
		});
		expect(cleared[0]?.note).toBeNull();

		const left = await context.commands.call('initiatives.delete', { id: initiativeId });
		expect(left.map(({ title }) => title)).toEqual(['Someday']);
		expect(rows('initiative_dependencies')).toBe(0);
		expect(rows('initiative_dependency_workstreams')).toBe(0);
	});

	it('ticks an outcome done and back, keeping the rest of it', async () => {
		const [created] = await context.commands.call('initiatives.create', {
			repositoryFullName: 'bestboyhq/grip',
			title: 'Ship billing',
			dueOn: '2026-12-01',
		});
		expect(created?.done).toBe(false);
		const id = created?.id ?? '';
		const [ticked] = await context.commands.call('initiatives.update', { id, done: true });
		expect(ticked).toMatchObject({ title: 'Ship billing', dueOn: '2026-12-01', done: true });
		const [renamed] = await context.commands.call('initiatives.update', { id, title: 'Billing' });
		expect(renamed?.done).toBe(true);
		const [unticked] = await context.commands.call('initiatives.update', { id, done: false });
		expect(unticked).toMatchObject({ title: 'Billing', done: false });
		await expect(
			context.commands.invoke({ command: 'initiatives.update', args: { id, done: 'yes' } }),
		).resolves.toMatchObject({ ok: false, error: expect.stringContaining('`done`') });
		expect((await context.commands.call('initiatives.list', undefined))[0]?.done).toBe(false);
	});

	it('refuses a missing repository, an empty title, a day that does not exist, an unknown id and an empty update', async () => {
		const send = (command: CommandName, args: unknown): Promise<unknown> =>
			context.commands.invoke({ command, args });
		const refused = (field: string) => ({
			ok: false,
			error: expect.stringContaining(field),
		});

		const repositoryFullName = 'bestboyhq/grip';
		for (const invalid of [undefined, 42, '  ', 'a'.repeat(REPOSITORY_FULL_NAME_MAX_LENGTH + 1)]) {
			await expect(
				send('initiatives.create', { repositoryFullName: invalid, title: 'Ship', dueOn: null }),
			).resolves.toMatchObject(refused('repositoryFullName'));
		}
		await expect(
			send('initiatives.create', { repositoryFullName, title: ' ', dueOn: null }),
		).resolves.toMatchObject(refused('title'));
		await expect(
			send('initiatives.create', { repositoryFullName, title: 'Line\nbreak', dueOn: null }),
		).resolves.toMatchObject(refused('title'));
		await expect(
			send('initiatives.create', { repositoryFullName, title: 'Leap', dueOn: '2026-02-30' }),
		).resolves.toMatchObject(refused('dueOn'));
		await expect(
			send('initiatives.update', { id: 'missing', title: 'Renamed' }),
		).resolves.toMatchObject(refused('no initiative missing'));
		await expect(
			send('initiatives.link-workstream', { dependencyId: 'missing', workstreamId: 'ws' }),
		).resolves.toMatchObject(refused('no initiative dependency missing'));

		const [initiative] = await context.commands.call('initiatives.create', {
			repositoryFullName,
			title: 'Ship billing',
			dueOn: null,
		});
		await expect(send('initiatives.update', { id: initiative?.id })).resolves.toMatchObject(
			refused('to change'),
		);
		await expect(
			send('initiatives.update', { id: initiative?.id, note: 'not a document' }),
		).resolves.toMatchObject(refused('note'));
		expect(rows('initiatives')).toBe(1);
	});
});
