import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AUTOMATIONS_RUN_CHANGED_CHANNEL,
	PULL_REQUESTS_SHIP_CHANGED_CHANNEL,
	PULL_REQUESTS_WORKSTREAM_OPENED_CHANNEL,
} from '$contract/events';
import type {
	AutomationDefinitionRecord,
	AutomationRunRecord,
	AutomationTrigger,
} from '$contract/automations';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { all } from '$main/db/rows';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import { upsertProject, upsertWorkstream } from '$shared/repositories/repositories.platform';
import type { AutomationsPlatform } from '../automations.platform';
import { getAutomationRunContext } from './automation-runs.repository';
import { registerAutomations } from './register';

const SHIP_MERGED = 'on pull-requests:ship-changed where merged is set and repositoryId is repo-1';

let db: MaliniDatabase;
let context: MainContext;
let automations: AutomationsPlatform;
let logged: string[];

function start(): void {
	context = {
		db,
		commands: new CommandRegistry(),
		events: createEventBus({ forwardToWindows: false }),
		appDataRoot: '/tmp/automation-triggers-test',
		checkoutsRoot: '/tmp/automation-triggers-test',
		resourcesRoot: '/tmp/automation-triggers-test',
		isDev: true,
		appVersion: '0.0.0-test',
	};
	context.commands.define('app.list-settings', () => ({}));
	context.commands.define('chat.workstream-has-working-run', () => true);
	automations = registerAutomations(context, { log: (line) => logged.push(line) });
}

beforeEach(() => {
	db = openMigratedDatabase(':memory:');
	upsertProject(db, {
		id: 'repo-1',
		name: 'repo-1',
		repoPath: '/tmp/repo-1',
		defaultBranch: 'main',
		createdAt: '2026-10-19T00:00:00Z',
	});
	upsertWorkstream(db, {
		id: 'ws-1',
		projectId: 'repo-1',
		name: 'ws-1',
		path: '/tmp/ws-1',
		branch: 'malini/ws-1',
		baseBranch: 'main',
		status: 'active',
		createdAt: '2026-10-19T00:00:00Z',
		scope: null,
		startedBy: null,
	});
	logged = [];
	start();
});

afterEach(() => {
	automations.dispose();
	db.close();
});

function automation(
	name: string,
	trigger: AutomationTrigger | null,
): Promise<AutomationDefinitionRecord> {
	return context.commands.call('automations.save-definition', {
		name,
		instructions: `${name}.`,
		provider: 'claude',
		model: 'opus',
		effort: 'low',
		runsIn: 'workstream',
		trigger,
	});
}

async function runsOf(definition: AutomationDefinitionRecord): Promise<AutomationRunRecord[]> {
	const runs = await context.commands.call('automations.list-runs', undefined);
	return runs.filter((run) => run.definitionId === definition.id);
}

function shipMerged(): void {
	context.events.emit(PULL_REQUESTS_SHIP_CHANGED_CHANNEL, {
		workstreamId: 'ws-1',
		state: null,
		merged: { pullRequestNumber: 7, pullRequestUrl: null },
	});
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

describe('automation triggers', () => {
	it('asks for a run on each matching event, waiting for you when the trigger asks first', async () => {
		const auto = await automation('Clean up', { when: SHIP_MERGED, mode: 'auto' });
		const ask = await automation('Write notes', { when: SHIP_MERGED, mode: 'ask' });
		const off = await automation('Never', { when: SHIP_MERGED, mode: 'off' });

		shipMerged();
		shipMerged();
		await settle();

		const [autoRun] = await runsOf(auto);
		expect(await runsOf(auto)).toHaveLength(1);
		expect(autoRun).toMatchObject({
			status: 'queued',
			origin: 'trigger',
			workstreamId: 'ws-1',
			parentRunId: null,
			requests: 2,
		});
		expect(await runsOf(ask)).toEqual([
			expect.objectContaining({
				status: 'waiting',
				origin: 'trigger',
				workstreamId: 'ws-1',
				requests: 2,
			}),
		]);
		expect(await runsOf(off)).toEqual([]);
	});

	it('starts an automation again on an event that repeats an earlier payload, but never twice on one event across a restart', async () => {
		const greet = await automation('Greet', {
			when: 'on pull-requests:workstream-opened',
			mode: 'ask',
		});
		const open = (): void =>
			context.events.emit(PULL_REQUESTS_WORKSTREAM_OPENED_CHANNEL, { workstreamId: 'ws-1' });
		const statuses = async () => (await runsOf(greet)).map(({ status }) => status);

		open();
		await settle();
		const [first] = await runsOf(greet);
		await context.commands.call('automations.cancel-run', { automationRunId: first?.id ?? '' });
		open();
		await settle();
		expect(await statuses()).toEqual(['waiting', 'cancelled']);

		automations.dispose();
		db.exec(
			`UPDATE event_log SET handled_at = NULL WHERE channel = '${PULL_REQUESTS_WORKSTREAM_OPENED_CHANNEL}'`,
		);
		start();
		await vi.waitFor(() =>
			expect(all(db, 'SELECT id FROM event_log WHERE handled_at IS NULL')).toEqual([]),
		);
		expect(await statuses()).toEqual(['waiting', 'cancelled']);
	});

	it('ignores an event whose payload misses a condition', async () => {
		const auto = await automation('Clean up', { when: SHIP_MERGED, mode: 'auto' });

		context.events.emit(PULL_REQUESTS_SHIP_CHANGED_CHANNEL, { workstreamId: 'ws-1', state: null });
		await settle();

		expect(await runsOf(auto)).toEqual([]);
	});

	it('follows a trigger as it is switched on, changed and switched off', async () => {
		const later = await automation('Later', null);
		shipMerged();
		await settle();
		expect(await runsOf(later)).toEqual([]);

		await context.commands.call('automations.save-definition', {
			...later,
			trigger: { when: 'on pull-requests:ship-changed where merged is set', mode: 'auto' },
		});
		shipMerged();
		await settle();
		expect(await runsOf(later)).toHaveLength(1);

		await context.commands.call('automations.save-definition', {
			...later,
			trigger: { when: 'on pull-requests:ship-changed where merged is set', mode: 'off' },
		});
		context.events.emit(PULL_REQUESTS_SHIP_CHANGED_CHANNEL, {
			workstreamId: 'ws-1',
			state: null,
			merged: { pullRequestNumber: 8, pullRequestUrl: null },
		});
		await settle();
		expect(await runsOf(later)).toHaveLength(1);
	});

	it('passes the run of an automations:run-changed event as the parent, so a chain never triggers itself', async () => {
		const build = await automation('Build', null);
		const notify = await automation('Notify', { when: 'on automations:run-changed', mode: 'auto' });
		const built = await context.commands.call('automations.run', {
			definitionId: build.id,
			workstreamId: 'ws-1',
		});
		await settle();

		const notified = await runsOf(notify);
		expect(notified).toEqual([
			expect.objectContaining({ origin: 'trigger', parentRunId: built.id, workstreamId: 'ws-1' }),
		]);
		expect(JSON.parse(String(getAutomationRunContext(db, notified[0]?.id ?? '')))).toMatchObject({
			event: AUTOMATIONS_RUN_CHANGED_CHANNEL,
			payload: { run: { id: built.id }, repositoryId: 'repo-1' },
		});
		expect(logged).toEqual([]);
	});
});
