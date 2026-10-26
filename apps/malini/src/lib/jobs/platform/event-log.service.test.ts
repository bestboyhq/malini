import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	APP_SCALE_CHANGED_CHANNEL,
	CHAT_RUN_CHANGES_CAPTURED_CHANNEL,
	JOBS_RUN_CHANGED_CHANNEL,
	JOBS_RUN_FINISHED_CHANNEL,
	JOBS_RUN_STARTED_CHANNEL,
	PULL_REQUESTS_PULL_REQUEST_CHANGED_CHANNEL,
	PULL_REQUESTS_SHIP_CHANGED_CHANNEL,
	REPOSITORIES_WORKSTREAM_FILES_CHANGED_CHANNEL,
} from '$contract/events';
import type { JobRunRecord, LoggedEventRecord } from '$contract/jobs';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { all, run } from '$main/db/rows';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import { insertRun } from '$lib/chat/platform/runs.repository';
import { insertSession } from '$lib/chat/platform/sessions.repository';
import { upsertProject, upsertWorkstream } from '$shared/repositories/repositories.platform';
import type { JobsPlatform } from '../jobs.platform';
import { insertLoggedEvent, linkJobRunEvent } from './event-log.repository';
import { eventDigest, pruneEvents } from './event-log.service';
import { insertJobRun, saveJobRun } from './job-runs.repository';
import { registerJobs } from './register';

const DAY_MS = 24 * 60 * 60 * 1_000;

let db: MaliniDatabase;
let context: MainContext;
let jobs: JobsPlatform | null;

function freshContext(): MainContext {
	const fresh: MainContext = {
		db,
		commands: new CommandRegistry(),
		events: createEventBus({ forwardToWindows: false }),
		appDataRoot: '/tmp/event-log-test',
		resourcesRoot: '/tmp/event-log-test',
		isDev: true,
		appVersion: '0.0.0-test',
	};
	fresh.commands.define('app.list-settings', () => ({}));
	fresh.commands.define('chat.workstream-has-working-run', () => true);
	return fresh;
}

beforeEach(() => {
	db = openMigratedDatabase(':memory:');
	context = freshContext();
	upsertProject(db, {
		id: 'project',
		name: 'project',
		repoPath: '/tmp/project',
		defaultBranch: 'main',
		createdAt: new Date().toISOString(),
	});
	upsertWorkstream(db, {
		id: 'ws-1',
		projectId: 'project',
		name: 'ws-1',
		path: '/tmp/ws-1',
		branch: 'malini/ws-1',
		baseBranch: 'main',
		status: 'active',
		createdAt: new Date().toISOString(),
		scope: null,
		startedBy: null,
	});
	jobs = null;
});

afterEach(() => {
	jobs?.dispose();
	db.close();
});

function start(): void {
	jobs = registerJobs(context, { log: () => {} });
	jobs.start();
}

async function logged(): Promise<LoggedEventRecord[]> {
	const timeline = await context.commands.call('jobs.list-timeline', {
		since: new Date(Date.now() - DAY_MS).toISOString(),
	});
	return [...timeline.events];
}

function filesChanged(): void {
	context.events.emit(REPOSITORIES_WORKSTREAM_FILES_CHANGED_CHANNEL, {
		workstreamId: 'ws-1',
		changedAt: new Date().toISOString(),
		paths: ['src/app.ts'],
	});
}

function jobRun(id: string, status: JobRunRecord['status'], chainId: string): JobRunRecord {
	const now = new Date().toISOString();
	return {
		id,
		definitionId: '',
		title: 'Fix checks',
		workstreamId: 'ws-1',
		repositoryId: null,
		scope: null,
		sessionId: null,
		agentRunId: null,
		origin: 'manual',
		status,
		detail: null,
		parentRunId: null,
		chatSessionId: null,
		chatAfterRunId: null,
		chainId,
		requests: 1,
		createdAt: now,
		startedAt: status === 'queued' ? null : now,
		finishedAt: null,
	};
}

async function fixChecksRun(id: string, chainId: string): Promise<JobRunRecord> {
	const definitions = await context.commands.call('jobs.list-definitions', undefined);
	const fixChecks = definitions.find((definition) => definition.builtin === 'fix-checks');
	const record = { ...jobRun(id, 'running', chainId), definitionId: fixChecks?.id ?? '' };
	insertJobRun(db, record, null);
	return record;
}

describe('the event log', () => {
	it('keeps each event with a chain of its own when no work caused it, never the noisy ones', async () => {
		start();
		filesChanged();
		context.events.emit(APP_SCALE_CHANGED_CHANNEL, {});

		const events = await logged();
		expect(events).toEqual([
			expect.objectContaining({
				channel: REPOSITORIES_WORKSTREAM_FILES_CHANGED_CHANNEL,
				workstreamId: 'ws-1',
				cause: null,
				payload: expect.objectContaining({ paths: ['src/app.ts'] }),
			}),
		]);
		expect(events[0]?.chainId).toEqual(expect.any(String));
	});

	it('names the job run working in that workstream as the cause, in its chain', async () => {
		start();
		await fixChecksRun('fix-1', 'chain-of-fix');
		filesChanged();
		context.events.emit(JOBS_RUN_CHANGED_CHANNEL, { run: jobRun('fix-1', 'running', 'x') });
		context.events.emit(JOBS_RUN_STARTED_CHANNEL, { run: jobRun('fix-1', 'running', 'x') });

		expect(await logged()).toEqual([
			expect.objectContaining({
				channel: REPOSITORIES_WORKSTREAM_FILES_CHANGED_CHANNEL,
				cause: { kind: 'job-run', id: 'fix-1' },
				chainId: 'chain-of-fix',
			}),
			expect.objectContaining({
				channel: JOBS_RUN_STARTED_CHANNEL,
				cause: { kind: 'job-run', id: 'fix-1' },
				chainId: 'chain-of-fix',
			}),
		]);
	});

	it('names the chat turn working in that workstream as the cause when no job runs there', async () => {
		start();
		const now = new Date().toISOString();
		insertSession(
			db,
			{
				id: 'chat-1',
				workstreamId: 'ws-1',
				model: null,
				providerSessionId: null,
				status: 'running',
				startedAt: now,
			},
			{ origin: 'user', displayName: 'Ship it' },
		);
		insertRun(db, {
			id: 'turn-1',
			sessionId: 'chat-1',
			prompt: 'Ship it',
			startedAt: now,
			completedAt: null,
			summary: null,
			error: null,
			chainId: 'chain-of-turn',
		});
		filesChanged();
		context.events.emit(CHAT_RUN_CHANGES_CAPTURED_CHANNEL, {
			sessionId: 'chat-1',
			runId: 'turn-1',
		});

		expect(await logged()).toEqual([
			expect.objectContaining({
				cause: { kind: 'chat-turn', id: 'turn-1' },
				chainId: 'chain-of-turn',
			}),
			expect.objectContaining({
				channel: CHAT_RUN_CHANGES_CAPTURED_CHANNEL,
				workstreamId: 'ws-1',
				cause: { kind: 'chat-turn', id: 'turn-1' },
			}),
		]);
	});

	it('names the work last done in a workstream as the cause of what shipping reports there', async () => {
		start();
		const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1_000).toISOString();
		insertSession(
			db,
			{
				id: 'chat-1',
				workstreamId: 'ws-1',
				model: null,
				providerSessionId: null,
				status: 'idle',
				startedAt: twoHoursAgo,
			},
			{ origin: 'user', displayName: 'Ship it' },
		);
		insertRun(db, {
			id: 'turn-1',
			sessionId: 'chat-1',
			prompt: 'Ship it',
			startedAt: twoHoursAgo,
			completedAt: twoHoursAgo,
			summary: 'Shipped.',
			error: null,
			chainId: 'chain-of-turn',
		});
		context.events.emit(PULL_REQUESTS_PULL_REQUEST_CHANGED_CHANNEL, {
			workstreamId: 'ws-1',
			pullRequestNumber: 7,
			pullRequestUrl: null,
			state: 'open',
			baseBranch: 'main',
			headSha: null,
			checks: 'failed',
			checksPending: false,
			failingChecks: ['test'],
			blockingChecks: [
				{ name: 'test', state: 'FAILURE', required: null, appId: null, completedAt: null },
			],
			reviewDecision: null,
			unresolvedThreads: 0,
			changeRequests: [],
			threads: [],
			behindBase: 0,
			conflicts: false,
			mergeability: 'blocked',
			viewerCanMerge: true,
			mergeMethod: 'squash',
		});
		context.events.emit(PULL_REQUESTS_SHIP_CHANGED_CHANNEL, { workstreamId: 'ws-1', state: null });
		filesChanged();

		expect(await logged()).toEqual([
			expect.objectContaining({
				channel: PULL_REQUESTS_PULL_REQUEST_CHANGED_CHANNEL,
				cause: { kind: 'chat-turn', id: 'turn-1' },
				chainId: 'chain-of-turn',
			}),
			expect.objectContaining({
				channel: PULL_REQUESTS_SHIP_CHANGED_CHANNEL,
				cause: { kind: 'chat-turn', id: 'turn-1' },
				chainId: 'chain-of-turn',
			}),
			expect.objectContaining({
				channel: REPOSITORIES_WORKSTREAM_FILES_CHANGED_CHANNEL,
				cause: null,
			}),
		]);
	});

	it('names a job, not the turn it ran in, as the cause of what follows it', async () => {
		start();
		const fix = await fixChecksRun('fix-1', 'chain-of-fix');
		const now = new Date().toISOString();
		insertSession(
			db,
			{
				id: 'job-chat',
				workstreamId: 'ws-1',
				model: null,
				providerSessionId: null,
				status: 'idle',
				startedAt: now,
			},
			{ origin: 'job', displayName: 'Fix checks' },
		);
		insertRun(db, {
			id: 'job-turn',
			sessionId: 'job-chat',
			prompt: 'Fix the checks',
			startedAt: now,
			completedAt: now,
			summary: 'Fixed.',
			error: null,
			chainId: 'chain-of-fix',
		});
		saveJobRun(db, { ...fix, sessionId: 'job-chat', status: 'succeeded', finishedAt: now });
		filesChanged();

		expect(await logged()).toEqual([
			expect.objectContaining({
				channel: REPOSITORIES_WORKSTREAM_FILES_CHANGED_CHANNEL,
				cause: { kind: 'job-run', id: 'fix-1' },
				chainId: 'chain-of-fix',
			}),
		]);
	});

	it('hands the events Malini had not finished handling to the triggers again when it starts', async () => {
		start();
		const definition = await context.commands.call('jobs.save-definition', {
			name: 'Announce the merge',
			instructions: 'Announce it.',
			model: 'opus',
			effort: 'low',
			runsIn: 'workstream',
			trigger: { when: 'on pull-requests:ship-changed where merged is set', mode: 'auto' },
		});
		jobs?.dispose();
		context = freshContext();
		const payload = {
			workstreamId: 'ws-1',
			state: null,
			merged: { pullRequestNumber: 7, pullRequestUrl: null },
		};
		const unhandled = (emittedAt: string) =>
			insertLoggedEvent(db, {
				channel: PULL_REQUESTS_SHIP_CHANGED_CHANNEL,
				payload: JSON.stringify(payload),
				digest: eventDigest(payload),
				workstreamId: 'ws-1',
				cause: null,
				chainId: `chain-${emittedAt}`,
				emittedAt,
			});
		const staleAt = new Date(Date.now() - 2 * 60 * 60 * 1_000).toISOString();
		const recentAt = new Date().toISOString();
		const stale = unhandled(staleAt);
		const recent = unhandled(recentAt);

		start();

		await vi.waitFor(async () => {
			const runs = await context.commands.call('jobs.list-runs', undefined);
			expect(runs.filter((run) => run.definitionId === definition.id)).toEqual([
				expect.objectContaining({ origin: 'trigger', chainId: `chain-${recentAt}` }),
			]);
		});
		const unhandledIds = () =>
			all<{ id: number }>(db, 'SELECT id FROM event_log WHERE handled_at IS NULL ORDER BY id');
		await vi.waitFor(() => expect(unhandledIds()).toEqual([{ id: stale }]));
		expect(recent).toBeGreaterThan(stale);
	});

	it('starts a Then once from the job finished event it hears, even when it hears it again after a restart', async () => {
		start();
		const save = (name: string, thenJobId: string | null) =>
			context.commands.call('jobs.save-definition', {
				name,
				instructions: 'Go.',
				model: 'opus',
				effort: 'low',
				runsIn: 'workstream',
				thenJobId,
			});
		const notes = await save('Write notes', null);
		const fix = await save('Fix it', notes.id);
		jobs?.dispose();
		context = freshContext();
		const finished = { ...jobRun('fix-1', 'succeeded', 'chain-of-fix'), definitionId: fix.id };
		insertJobRun(db, finished, null);
		const payload = { run: finished };
		insertLoggedEvent(db, {
			channel: JOBS_RUN_FINISHED_CHANNEL,
			payload: JSON.stringify(payload),
			digest: eventDigest(payload),
			workstreamId: 'ws-1',
			cause: { kind: 'job-run', id: 'fix-1' },
			chainId: 'chain-of-fix',
			emittedAt: new Date().toISOString(),
		});
		const thens = async () =>
			(await context.commands.call('jobs.list-runs', undefined)).filter(
				(run) => run.definitionId === notes.id,
			);

		start();
		await vi.waitFor(async () =>
			expect(await thens()).toEqual([
				expect.objectContaining({ origin: 'then', parentRunId: 'fix-1', chainId: 'chain-of-fix' }),
			]),
		);
		jobs?.dispose();
		context = freshContext();
		run(db, "UPDATE job_runs SET status = 'succeeded' WHERE definition_id = ?", notes.id);
		run(db, 'UPDATE event_log SET handled_at = NULL');
		start();

		await vi.waitFor(() =>
			expect(all(db, 'SELECT id FROM event_log WHERE handled_at IS NULL')).toEqual([]),
		);
		expect(await thens()).toHaveLength(1);
	});

	it('forgets events older than a week, with their links to the runs they started', () => {
		const old = insertLoggedEvent(db, {
			channel: REPOSITORIES_WORKSTREAM_FILES_CHANGED_CHANNEL,
			payload: '{}',
			digest: eventDigest({}),
			workstreamId: 'ws-1',
			cause: null,
			chainId: 'old',
			emittedAt: new Date(Date.now() - 8 * DAY_MS).toISOString(),
		});
		const fresh = insertLoggedEvent(db, {
			channel: REPOSITORIES_WORKSTREAM_FILES_CHANGED_CHANNEL,
			payload: '{}',
			digest: eventDigest({}),
			workstreamId: 'ws-1',
			cause: null,
			chainId: 'fresh',
			emittedAt: new Date().toISOString(),
		});
		start();
		insertJobRun(db, { ...jobRun('linked', 'succeeded', 'old'), definitionId: firstJobId() }, null);
		linkJobRunEvent(db, 'linked', old);
		linkJobRunEvent(db, 'linked', fresh);

		pruneEvents(db);

		expect(all(db, 'SELECT id FROM event_log ORDER BY id')).toEqual([{ id: fresh }]);
		expect(all(db, 'SELECT event_id FROM job_run_events')).toEqual([{ event_id: fresh }]);
	});
});

function firstJobId(): string {
	const row = all<{ id: string }>(db, 'SELECT id FROM job_definitions LIMIT 1')[0];
	if (!row) throw new Error('no job definitions');
	return row.id;
}
