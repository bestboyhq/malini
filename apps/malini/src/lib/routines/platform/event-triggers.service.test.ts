import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JOBS_RUN_CHANGED_CHANNEL, PULL_REQUESTS_SHIP_CHANGED_CHANNEL } from '$contract/events';
import type { JobRunRecord } from '$contract/jobs';
import type { RoutineGatedRunRecord, RoutineRecord } from '$contract/routines';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { isRecord } from '$main/db/rows';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import { upsertProject, upsertWorkstream } from '$shared/repositories/repositories.platform';
import type { RoutinesPlatform } from '../routines.platform';
import { registerRoutines } from './register';

const SHIP_TRIGGER = 'on pull-requests:ship-changed where merged is set and repositoryId is repo-1';

let db: MaliniDatabase;
let context: MainContext;
let service: RoutinesPlatform;
let jobRuns: Record<string, unknown>[];

beforeEach(() => {
	db = openMigratedDatabase(':memory:');
	context = {
		db,
		commands: new CommandRegistry(),
		events: createEventBus({ forwardToWindows: false }),
		appDataRoot: '/tmp/routines-test',
		resourcesRoot: '/tmp/routines-test',
		isDev: true,
		appVersion: '0.0.0-test',
	};
	jobRuns = [];
	context.commands.define('jobs.run', (args: unknown) => {
		if (!isRecord(args)) throw new Error('jobs.run needs arguments');
		jobRuns.push(args);
		const queued = jobRun(`job-run-${jobRuns.length}`, String(args['definitionId']), 'queued');
		setTimeout(() => {
			context.events.emit(JOBS_RUN_CHANGED_CHANNEL, { run: { ...queued, status: 'succeeded' } });
		}, 0);
		return queued;
	});
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
	});
	service = registerRoutines(context, { log: () => {} });
});

afterEach(() => {
	service.dispose();
	db.close();
});

function jobRun(id: string, definitionId: string, status: JobRunRecord['status']): JobRunRecord {
	return {
		id,
		definitionId,
		title: definitionId,
		workstreamId: 'ws-1',
		repositoryId: null,
		sessionId: null,
		agentRunId: null,
		origin: 'routine',
		status,
		detail: null,
		chatSessionId: null,
		chatAfterRunId: null,
		createdAt: '2026-10-19T00:00:00Z',
		startedAt: null,
		finishedAt: null,
	};
}

async function invoke<T>(command: string, args?: unknown): Promise<T>;
async function invoke(command: string, args: unknown = {}): Promise<unknown> {
	const response = await context.commands.invoke({ command, args });
	if (!response.ok) throw new Error(response.error);
	return response.value;
}

async function routine(
	status: RoutineRecord['status'],
	when = SHIP_TRIGGER,
): Promise<RoutineRecord> {
	const draft = await invoke<RoutineRecord>('routines.create-draft', {
		label: 'Clean up after a merge',
		when,
		steps: [{ job: 'cleanup' }, { job: 'notes' }],
	});
	if (status === 'draft') return draft;
	await invoke('routines.promote', { routineId: draft.id });
	if (status === 'candidate') return { ...draft, status };
	await invoke('routines.promote', { routineId: draft.id });
	return { ...draft, status };
}

function shipMerged(workstreamId = 'ws-1'): void {
	context.events.emit(PULL_REQUESTS_SHIP_CHANGED_CHANNEL, {
		workstreamId,
		state: null,
		merged: { pullRequestNumber: 7, pullRequestUrl: null },
	});
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

describe('routines on contract events', () => {
	it('runs a promoted routine’s jobs in order on a matching event', async () => {
		await routine('routine');
		shipMerged();
		await settle();
		expect(jobRuns.map((run) => run['definitionId'])).toEqual(['cleanup', 'notes']);
		expect(jobRuns[0]).toMatchObject({
			workstreamId: 'ws-1',
			repositoryId: 'repo-1',
			origin: 'routine',
		});
		expect(JSON.parse(String(jobRuns[0]?.['context']))).toMatchObject({
			event: 'pull-requests:ship-changed',
			payload: { workstreamId: 'ws-1', repositoryId: 'repo-1' },
		});
	});

	it('ignores an event whose payload misses a condition', async () => {
		await routine('routine');
		context.events.emit(PULL_REQUESTS_SHIP_CHANGED_CHANNEL, { workstreamId: 'ws-1', state: null });
		await settle();
		expect(jobRuns).toEqual([]);
	});

	it('fires once per event identity and never on its own job runs', async () => {
		await routine('routine', 'on jobs:run-changed');
		shipMerged();
		shipMerged();
		context.events.emit(JOBS_RUN_CHANGED_CHANNEL, { run: jobRun('own', 'cleanup', 'running') });
		await settle();
		expect(jobRuns).toEqual([]);
		const manual = { ...jobRun('manual-1', 'build', 'succeeded'), origin: 'manual' as const };
		context.events.emit(JOBS_RUN_CHANGED_CHANNEL, { run: manual });
		context.events.emit(JOBS_RUN_CHANGED_CHANNEL, { run: manual });
		await settle();
		expect(jobRuns.map((run) => run['definitionId'])).toEqual(['cleanup', 'notes']);
	});

	it('holds a candidate’s run until it is confirmed, then runs it', async () => {
		const candidate = await routine('candidate');
		shipMerged();
		shipMerged();
		await settle();
		expect(jobRuns).toEqual([]);
		const pending = await invoke<RoutineGatedRunRecord[]>('routines.list-gated-runs', {
			state: 'pending',
		});
		expect(pending).toHaveLength(1);
		expect(pending[0]).toMatchObject({
			routineId: candidate.id,
			workstreamId: 'ws-1',
			event: 'pull-requests:ship-changed',
			payload: { repositoryId: 'repo-1' },
		});
		await invoke('routines.confirm-run', { gatedRunId: pending[0]?.id });
		await settle();
		expect(jobRuns.map((run) => run['definitionId'])).toEqual(['cleanup', 'notes']);
	});

	it('never fires a draft', async () => {
		await routine('draft');
		shipMerged();
		await settle();
		expect(jobRuns).toEqual([]);
		expect(await invoke<RoutineGatedRunRecord[]>('routines.list-gated-runs', {})).toEqual([]);
	});

	it('only accepts job steps for an event routine', async () => {
		await expect(
			invoke('routines.create-draft', {
				label: 'Open the preview',
				when: SHIP_TRIGGER,
				steps: [{ command: 'malini.preview.open', args: [] }],
			}),
		).rejects.toThrow(/every step must be a job/u);
		const draft = await invoke<RoutineRecord>('routines.create-draft', {
			label: 'Open the preview',
			when: 'when I run it',
			steps: [{ command: 'malini.preview.open', args: [] }],
		});
		await expect(
			invoke('routines.update', { routineId: draft.id, when: SHIP_TRIGGER }),
		).rejects.toThrow(/every step must be a job/u);
	});
});
