import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_AGENT_EVENT_CHANNEL, JOBS_TIME_REACHED_CHANNEL } from '$contract/events';
import type { JobDefinitionRecord, JobRunRecord, JobTrigger } from '$contract/jobs';
import type { WorkstreamDto, WorktreeStatus } from '$contract/repositories';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { all } from '$main/db/rows';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import {
	getWorkstream,
	upsertConnectedRepository,
	upsertProject,
	upsertWorkstream,
} from '$shared/repositories/repositories.platform';
import type { JobsPlatform } from '../jobs.platform';
import { SCHEDULE_CHECK_INTERVAL_MS } from './job-schedules.service';
import { registerJobs } from './register';

const MONDAY = 26;

let db: MaliniDatabase;
let context: MainContext;
let jobs: JobsPlatform;
let notices: unknown[];
let prompts: string[];
let behind: number;
let pulls: number;

const at = (day: number, hour: number, minute = 0): Date => new Date(2026, 9, day, hour, minute);

function seedWorkstream(id: string, projectId: string, name: string, scope: string | null): void {
	upsertWorkstream(db, {
		id,
		projectId,
		name,
		path: `/tmp/${id}`,
		branch: `malini/${id}`,
		baseBranch: 'main',
		status: 'active',
		createdAt: at(MONDAY, 0).toISOString(),
		scope,
		startedBy: null,
	});
}

function field(args: unknown, key: string): string {
	return String(Reflect.get(Object(args), key));
}

function worktree(): WorktreeStatus {
	return {
		branch: 'malini/x',
		dirtyPaths: [],
		conflictedPaths: [],
		conflictMarkerPaths: [],
		ahead: 0,
		behind: 0,
		hasUpstream: true,
		mergeInProgress: false,
		operationInProgress: null,
		headSha: 'a'.repeat(40),
	};
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
	vi.setSystemTime(at(MONDAY, 8, 59));
	db = openMigratedDatabase(':memory:');
	notices = [];
	prompts = [];
	behind = 0;
	pulls = 0;
	const commands = new CommandRegistry();
	context = {
		db,
		commands,
		events: createEventBus({ forwardToWindows: false }),
		appDataRoot: '/tmp/job-schedules-test',
		resourcesRoot: '/tmp/job-schedules-test',
		isDev: true,
		appVersion: '0.0.0-test',
	};
	upsertProject(db, {
		id: 'malini-lead-space',
		name: 'malini-lead-space',
		repoPath: '/tmp/lead-space',
		defaultBranch: 'main',
		createdAt: at(MONDAY, 0).toISOString(),
	});
	upsertProject(db, {
		id: 'local__acme__app',
		name: 'acme__app',
		repoPath: '/tmp/acme-app',
		defaultBranch: 'main',
		createdAt: at(MONDAY, 0).toISOString(),
	});
	upsertConnectedRepository(db, {
		id: 'repo-1',
		fullName: 'acme/app',
		defaultBranch: 'main',
		localPath: null,
		remoteUrl: 'https://github.com/acme/app.git',
		createdAt: at(MONDAY, 0).toISOString(),
	});
	let sessions = 0;
	commands.define('app.list-settings', () => ({}));
	commands.define('app.notification-permission-granted', () => true);
	commands.define('app.notify', (args: unknown) => {
		notices.push(args);
	});
	commands.define('chat.workstream-has-working-run', () => false);
	commands.define('chat.start-session', () => `session-${++sessions}`);
	commands.define('chat.send-prompt', (args: unknown) => {
		prompts.push(String(Reflect.get(Object(args), 'prompt')));
		return `agent-run-${sessions}`;
	});
	commands.define('repositories.create-lead', (args: unknown): WorkstreamDto => {
		const id = `lead-${sessions + 1}`;
		seedWorkstream(id, 'malini-lead-space', field(args, 'name'), field(args, 'scope'));
		const lead = getWorkstream(db, id);
		if (!lead) throw new Error('the lead is missing');
		return {
			...lead,
			activeAt: lead.createdAt,
			checkoutState: 'healthy',
			checkoutIssue: null,
			resolvedPath: lead.path,
		};
	});
	commands.define('repositories.create-workstream', (args: unknown) => {
		seedWorkstream(field(args, 'workstreamId'), 'local__acme__app', field(args, 'name'), null);
		return '/tmp/new-workstream';
	});
	commands.define('repositories.sync-workstream-base', () => 'current' as const);
	commands.define('repositories.provision-dependencies', () => ({ status: 'succeeded' as const }));
	commands.define('repositories.workstream-status', () => worktree());
	commands.define('repositories.count-behind-base', () => behind);
	commands.define('repositories.pull-workstream', () => {
		pulls += 1;
		return 'abc1234';
	});
	jobs = registerJobs(context, { log: () => {} });
	jobs.start();
});

afterEach(() => {
	jobs.dispose();
	db.close();
	vi.useRealTimers();
});

function schedule(when: string, mode: JobTrigger['mode'] = 'auto'): Promise<JobDefinitionRecord> {
	return context.commands.call('jobs.save-definition', {
		name: 'Triage',
		instructions: 'Triage what came in.',
		model: 'opus',
		effort: 'low',
		runsIn: 'workstream',
		trigger: { when, mode },
	});
}

async function runs(): Promise<JobRunRecord[]> {
	return (await context.commands.call('jobs.list-runs', undefined)).reverse();
}

async function passTo(time: Date): Promise<void> {
	vi.setSystemTime(time);
	await vi.advanceTimersByTimeAsync(SCHEDULE_CHECK_INTERVAL_MS);
}

function finish(run: JobRunRecord | undefined): void {
	if (!run?.sessionId) throw new Error('the run has no chat');
	context.events.emit(CHAT_AGENT_EVENT_CHANNEL, {
		sessionId: run.sessionId,
		runId: run.agentRunId ?? 'agent-run',
		seq: 1,
		event: { type: 'run.completed', summary: 'Nothing new.' },
	});
}

describe('job schedules', () => {
	it('starts a job at its time in its own chat at Home, once for each time it comes', async () => {
		await schedule('every weekday at 09:00');
		await passTo(at(MONDAY, 8, 59));
		expect(await runs()).toEqual([]);

		await passTo(at(MONDAY, 9));
		await vi.waitFor(async () =>
			expect(await runs()).toEqual([
				expect.objectContaining({ origin: 'schedule', scope: 'home', workstreamId: 'lead-1' }),
			]),
		);
		expect(getWorkstream(db, 'lead-1')?.scope).toBe('home');
		expect(prompts[0]).toBe(
			'Triage what came in.\n\nMalini started this run on its schedule, every weekday at 09:00, due Monday, October 26 at 09:00.',
		);

		await passTo(at(MONDAY, 12));
		expect(await runs()).toHaveLength(1);
	});

	it('starts a run on the Time reached it logs, names it as the cause, and never twice for one time', async () => {
		const job = await schedule('every weekday at 09:00');
		await passTo(at(MONDAY, 9));
		await vi.waitFor(async () => expect(await runs()).toHaveLength(1));
		const [reached] = all<{ id: number; payload: string }>(
			db,
			'SELECT id, payload FROM event_log WHERE channel = ?',
			JOBS_TIME_REACHED_CHANNEL,
		);
		expect(JSON.parse(reached?.payload ?? 'null')).toEqual({
			definitionId: job.id,
			name: 'Triage',
			when: 'every weekday at 09:00',
			due: at(MONDAY, 9).toISOString(),
		});
		const [run] = await runs();
		expect(
			all<{ event_id: number }>(
				db,
				'SELECT event_id FROM job_run_events WHERE job_run_id = ?',
				run?.id ?? '',
			),
		).toEqual([{ event_id: reached?.id }]);

		finish(run);
		context.events.emit(JOBS_TIME_REACHED_CHANNEL, JSON.parse(reached?.payload ?? 'null'));
		await vi.waitFor(() =>
			expect(
				all(db, 'SELECT id FROM event_log WHERE channel = ?', JOBS_TIME_REACHED_CHANNEL),
			).toHaveLength(2),
		);
		await vi.advanceTimersByTimeAsync(SCHEDULE_CHECK_INTERVAL_MS);
		expect(await runs()).toHaveLength(1);
	});

	it('catches up once on the times it missed, but never on a time before it was set', async () => {
		vi.setSystemTime(at(MONDAY, 10));
		await schedule('every day at 09:00 in acme');
		await passTo(at(MONDAY, 10, 1));
		expect(await runs()).toEqual([]);

		await passTo(at(MONDAY + 3, 12));
		await vi.waitFor(async () =>
			expect(await runs()).toEqual([
				expect.objectContaining({ origin: 'schedule', scope: 'owner:acme' }),
			]),
		);
		const [first] = await runs();
		finish(first);
		await passTo(at(MONDAY + 4, 9));
		await vi.waitFor(async () =>
			expect((await runs())[1]).toMatchObject({
				scope: 'owner:acme',
				workstreamId: first?.workstreamId,
			}),
		);
	});

	it('skips its time while the last run is unfinished, then runs again in its own workstream, merged with main', async () => {
		await schedule('every day at 09:00 in acme/app');
		await passTo(at(MONDAY, 9));
		await vi.waitFor(async () =>
			expect((await runs())[0]).toMatchObject({ status: 'running', repositoryId: 'repo-1' }),
		);
		const [first] = await runs();
		expect(getWorkstream(db, first?.workstreamId ?? '')?.name).toBe('Triage');

		await passTo(at(MONDAY + 1, 9));
		expect(await runs()).toHaveLength(1);

		finish(first);
		behind = 3;
		await passTo(at(MONDAY + 2, 9));
		await vi.waitFor(async () =>
			expect((await runs())[1]).toMatchObject({
				status: 'running',
				workstreamId: first?.workstreamId,
			}),
		);
		expect(pulls).toBe(1);
		expect(prompts[1]).not.toContain('did not merge');
	});

	it('tells you when a run waits for your yes and when it finishes', async () => {
		await schedule('every day at 09:00 in acme', 'ask');
		await passTo(at(MONDAY, 9));
		await vi.waitFor(() =>
			expect(notices).toEqual([
				{
					options: {
						title: 'Triage wants to run',
						body: 'It waits for your yes under Automations.',
					},
				},
			]),
		);
		const [waiting] = await runs();
		await context.commands.call('jobs.confirm-run', { jobRunId: waiting?.id ?? '' });
		await vi.waitFor(async () => expect((await runs())[0]?.status).toBe('running'));
		finish((await runs())[0]);
		await vi.waitFor(() =>
			expect(notices.at(-1)).toEqual({
				options: {
					title: 'Triage finished',
					body: 'Nothing new.',
					opens: { workstreamId: 'lead-1', sessionId: 'session-1' },
				},
			}),
		);
	});

	it('saves a schedule in the casing Malini knows, and refuses a place it does not know', async () => {
		expect((await schedule('every Weekday at 9:00 in ACME/App')).trigger?.when).toBe(
			'every weekday at 09:00 in acme/app',
		);
		await expect(schedule('every day at 09:00 in acme/elsewhere')).rejects.toThrow(
			/No repository in Malini is `acme\/elsewhere`/u,
		);
		await expect(schedule('every day at 09:00 in nobody')).rejects.toThrow(
			/No repository in Malini belongs to `nobody`/u,
		);
		const definitions = await context.commands.call('jobs.list-definitions', undefined);
		const merge = definitions.find((definition) => definition.builtin === 'merge');
		if (!merge) throw new Error('the built-in Merge job is missing');
		await expect(
			context.commands.call('jobs.save-definition', {
				...merge,
				trigger: { when: 'every day at 09:00', mode: 'auto' },
			}),
		).rejects.toThrow(/never on a schedule/u);
	});
});
