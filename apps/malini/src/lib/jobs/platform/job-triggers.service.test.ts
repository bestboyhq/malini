import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JOBS_RUN_CHANGED_CHANNEL, PULL_REQUESTS_SHIP_CHANGED_CHANNEL } from '$contract/events';
import type { JobDefinitionRecord, JobRunRecord, JobTrigger } from '$contract/jobs';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import { upsertProject, upsertWorkstream } from '$shared/repositories/repositories.platform';
import type { JobsPlatform } from '../jobs.platform';
import { getJobRunContext } from './job-runs.repository';
import { registerJobs } from './register';

const SHIP_MERGED = 'on pull-requests:ship-changed where merged is set and repositoryId is repo-1';

let db: MaliniDatabase;
let context: MainContext;
let jobs: JobsPlatform;
let logged: string[];

beforeEach(() => {
	db = openMigratedDatabase(':memory:');
	context = {
		db,
		commands: new CommandRegistry(),
		events: createEventBus({ forwardToWindows: false }),
		appDataRoot: '/tmp/job-triggers-test',
		resourcesRoot: '/tmp/job-triggers-test',
		isDev: true,
		appVersion: '0.0.0-test',
	};
	context.commands.define('app.list-settings', () => ({}));
	context.commands.define('chat.workstream-has-working-run', () => true);
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
	jobs = registerJobs(context, { log: (line) => logged.push(line) });
});

afterEach(() => {
	jobs.dispose();
	db.close();
});

function job(name: string, trigger: JobTrigger | null): Promise<JobDefinitionRecord> {
	return context.commands.call('jobs.save-definition', {
		name,
		instructions: `${name}.`,
		model: 'opus',
		effort: 'low',
		runsIn: 'workstream',
		trigger,
	});
}

async function runsOf(definition: JobDefinitionRecord): Promise<JobRunRecord[]> {
	const runs = await context.commands.call('jobs.list-runs', undefined);
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

describe('job triggers', () => {
	it('asks for a run on a matching event, waiting for you when the trigger asks first', async () => {
		const auto = await job('Clean up', { when: SHIP_MERGED, mode: 'auto' });
		const ask = await job('Write notes', { when: SHIP_MERGED, mode: 'ask' });
		const off = await job('Never', { when: SHIP_MERGED, mode: 'off' });

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
		});
		expect(await runsOf(ask)).toEqual([
			expect.objectContaining({ status: 'waiting', origin: 'trigger', workstreamId: 'ws-1' }),
		]);
		expect(await runsOf(off)).toEqual([]);
	});

	it('ignores an event whose payload misses a condition', async () => {
		const auto = await job('Clean up', { when: SHIP_MERGED, mode: 'auto' });

		context.events.emit(PULL_REQUESTS_SHIP_CHANGED_CHANNEL, { workstreamId: 'ws-1', state: null });
		await settle();

		expect(await runsOf(auto)).toEqual([]);
	});

	it('follows a trigger as it is switched on, changed and switched off', async () => {
		const later = await job('Later', null);
		shipMerged();
		await settle();
		expect(await runsOf(later)).toEqual([]);

		await context.commands.call('jobs.save-definition', {
			...later,
			trigger: { when: 'on pull-requests:ship-changed where merged is set', mode: 'auto' },
		});
		shipMerged();
		await settle();
		expect(await runsOf(later)).toHaveLength(1);

		await context.commands.call('jobs.save-definition', {
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

	it('passes the run of a jobs:run-changed event as the parent, so a chain never triggers itself', async () => {
		const build = await job('Build', null);
		const notify = await job('Notify', { when: 'on jobs:run-changed', mode: 'auto' });
		const built = await context.commands.call('jobs.run', {
			definitionId: build.id,
			workstreamId: 'ws-1',
		});
		await settle();

		const notified = await runsOf(notify);
		expect(notified).toEqual([
			expect.objectContaining({ origin: 'trigger', parentRunId: built.id, workstreamId: 'ws-1' }),
		]);
		expect(JSON.parse(String(getJobRunContext(db, notified[0]?.id ?? '')))).toMatchObject({
			event: JOBS_RUN_CHANGED_CHANNEL,
			payload: { run: { id: built.id }, repositoryId: 'repo-1' },
		});
		expect(logged).toEqual([]);
	});
});
