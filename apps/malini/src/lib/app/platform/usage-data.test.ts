import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, net: {} }));

import { APP_STARTED_CHANNEL, CHAT_AGENT_EVENT_CHANNEL } from '$contract/events';
import type { UsageReport } from '$contract/system';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { run } from '$main/db/rows';
import { USAGE_DATA_SETTING } from '../domain/usage-data';
import { setSetting } from './settings.repository';
import { createTestContext } from './test-support';
import { startUsageData, type UsageActivity } from './usage-data';

const NOW = new Date(2026, 9, 15, 10);

function harness(
	context: MainContext = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') }),
) {
	const activity: UsageActivity[] = [];
	const reports: UsageReport[] = [];
	const errors: string[] = [];
	let throwUncaught: (error: unknown) => void = () => undefined;
	let goneProcess: (process: string, reason: string, exitCode: number) => void = () => undefined;
	startUsageData(context, {
		sink: {
			activity: (name) => activity.push(name),
			report: (report) => reports.push(report),
			error: (message) => errors.push(message),
			shutdown: () => Promise.resolve(),
		},
		hooks: {
			onUncaughtException: (listener) => {
				throwUncaught = listener;
				return () => undefined;
			},
			onUnhandledRejection: () => () => undefined,
		},
		processGone: (listener) => {
			goneProcess = listener;
		},
		system: 'malini 1.0.0',
		now: () => NOW,
	});
	return {
		context,
		activity,
		reports,
		errors,
		start: () => context.events.emit(APP_STARTED_CHANNEL, { version: '1.0.0' }),
		throwUncaught: (error: unknown) => throwUncaught(error),
		goneProcess: (process: string, reason: string) => goneProcess(process, reason, 9),
	};
}

function finishRun(context: MainContext, type: string): void {
	context.events.emit(CHAT_AGENT_EVENT_CHANNEL, {
		sessionId: 's1',
		runId: 'r1',
		seq: 1,
		event: { type, runId: 'r1' },
	});
}

async function failCommand(context: MainContext, error: Error): Promise<void> {
	context.commands.define('repositories.list-workstreams', () => {
		throw error;
	});
	await context.commands.handle({ command: 'repositories.list-workstreams', args: undefined });
}

describe('usage data', () => {
	it('reports the app as active once per launch', () => {
		expect(harness().activity).toEqual(['app_active']);
	});

	it('counts every run that finishes, and nothing else an agent does', () => {
		const { context, activity } = harness();
		finishRun(context, 'run.started');
		finishRun(context, 'tool.completed');
		finishRun(context, 'run.completed');
		finishRun(context, 'run.failed');
		expect(activity).toEqual(['app_active', 'run_finished', 'run_finished']);
	});

	it('logs a failed command by its error name, never its message, once per launch', async () => {
		const { context, errors } = harness();
		const error = Object.assign(new Error('cannot read /Users/me/secret-client'), {
			code: 'ENOENT',
		});
		await failCommand(context, error);
		await context.commands.handle({ command: 'repositories.list-workstreams', args: undefined });
		expect(errors).toEqual(['repositories.list-workstreams failed: Error ENOENT · malini 1.0.0']);
	});

	it('leaves out failures Malini expects, like a signed-out GitHub', async () => {
		const { context, errors } = harness();
		await failCommand(
			context,
			Object.assign(new Error('sign in'), { name: 'GhError', kind: 'auth-required' }),
		);
		expect(errors).toEqual([]);
	});

	it('logs crashes and uncaught exceptions', () => {
		const { errors, throwUncaught, goneProcess } = harness();
		throwUncaught(new TypeError('x is undefined in /Users/me'));
		goneProcess('renderer', 'oom');
		expect(errors).toEqual([
			'uncaught exception: TypeError · malini 1.0.0',
			'renderer process gone: oom, exit 9 · malini 1.0.0',
		]);
	});

	it("reports yesterday's loop once a day: workstreams started, prompts, merges, drops, and a typical merge", () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		seedLoop(context.db);
		const first = harness(context);
		first.start();
		first.start();
		const second = harness(context);
		second.start();
		expect(first.reports).toEqual([
			{
				day: '2026-10-14',
				started: 2,
				prompts: 3,
				merged: 2,
				archived: 1,
				turns: 3,
				minutes: 840,
				age: 'month_1',
			},
		]);
		expect(second.reports).toEqual([]);
	});

	it('reports nothing for a day nothing happened', () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		seedProject(context.db);
		seedWorkstream(context.db, 'ws-old', { createdAt: at(1, 9) });
		const { reports, start } = harness(context);
		start();
		expect(reports).toEqual([]);
	});

	it('sends nothing once the user turns usage data off', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		seedLoop(context.db);
		setSetting(context.db, USAGE_DATA_SETTING, 'off');
		const { activity, reports, errors, start } = harness(context);
		start();
		finishRun(context, 'run.completed');
		await failCommand(context, new Error('disk gone'));
		expect([...activity, ...reports, ...errors]).toEqual([]);
	});
});

function at(day: number, hour: number, minute = 0): string {
	return new Date(2026, 9, day, hour, minute).toISOString();
}

function seedProject(db: MaliniDatabase): void {
	run(
		db,
		`INSERT INTO projects (id, name, repo_path, default_branch, created_at)
		 VALUES ('p', 'p', '/tmp/repo', 'main', ?)`,
		at(1, 9),
	);
}

function seedLoop(db: MaliniDatabase): void {
	seedProject(db);
	seedWorkstream(db, 'ws-old', { createdAt: at(1, 9) });
	seedWorkstream(db, 'ws-a', { createdAt: at(14, 9), archivedAt: at(14, 10), merged: true });
	seedWorkstream(db, 'ws-b', { createdAt: at(13, 9), archivedAt: at(14, 12), merged: true });
	seedWorkstream(db, 'ws-c', { createdAt: at(14, 13), archivedAt: at(14, 14) });
	seedWorkstream(db, 'ws-lead', { createdAt: at(14, 9), scope: 'home' });
	seedWorkstream(db, 'ws-today', { createdAt: at(15, 9) });
	seedRun(db, 'r1', 'ws-a', at(14, 9, 5));
	seedRun(db, 'r2', 'ws-a', at(14, 9, 30));
	seedRun(db, 'r3', 'ws-a', at(14, 9, 40), 'job');
	seedRun(db, 'r4', 'ws-b', at(13, 9, 5));
	seedRun(db, 'r5', 'ws-b', at(13, 10));
	seedRun(db, 'r6', 'ws-b', at(14, 11));
	seedRun(db, 'r7', 'ws-b', at(14, 11, 30));
	seedRun(db, 'r8', 'ws-lead', at(14, 9, 10));
	seedRun(db, 'r9', 'ws-today', at(15, 9, 5));
	run(db, "UPDATE agent_runs SET automated = 1 WHERE id = 'r7'");
}

function seedWorkstream(
	db: MaliniDatabase,
	id: string,
	options: Readonly<{ createdAt: string; archivedAt?: string; merged?: boolean; scope?: string }>,
): void {
	run(
		db,
		`INSERT INTO workstreams
		   (id, project_id, name, path, branch, base_branch, status, created_at, scope,
		    archived_at, merged_pull_request_number)
		 VALUES (?, 'p', ?, '/tmp/ws', 'malini/ws', 'main', ?, ?, ?, ?, ?)`,
		id,
		id,
		options.archivedAt ? 'archived' : 'active',
		options.createdAt,
		options.scope ?? null,
		options.archivedAt ?? null,
		options.merged ? 7 : null,
	);
}

function seedRun(
	db: MaliniDatabase,
	id: string,
	workstreamId: string,
	startedAt: string,
	origin: 'user' | 'job' = 'user',
): void {
	run(
		db,
		`INSERT INTO agent_sessions (id, workstream_id, status, started_at, origin)
		 VALUES (?, ?, 'idle', ?, ?)`,
		`s-${id}`,
		workstreamId,
		startedAt,
		origin,
	);
	run(
		db,
		`INSERT INTO agent_runs (id, session_id, prompt, started_at, completed_at)
		 VALUES (?, ?, 'prompt', ?, ?)`,
		id,
		`s-${id}`,
		startedAt,
		startedAt,
	);
}
