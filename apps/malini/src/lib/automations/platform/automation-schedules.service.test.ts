import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AUTOMATIONS_RUN_CHANGED_CHANNEL,
	AUTOMATIONS_TIME_REACHED_CHANNEL,
	CHAT_AGENT_EVENT_CHANNEL,
} from '$contract/events';
import type {
	AutomationDefinitionRecord,
	AutomationRunRecord,
	AutomationTrigger,
} from '$contract/automations';
import type { WorktreeStatus } from '$contract/repositories';
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
import type { AutomationsPlatform } from '../automations.platform';
import { setAlarm } from './alarms.repository';
import {
	ALARM_CHECK_INTERVAL_MS,
	SCHEDULE_CHECK_INTERVAL_MS,
} from './automation-schedules.service';
import { registerAutomations } from './register';

const MONDAY = 26;

let db: MaliniDatabase;
let context: MainContext;
let automations: AutomationsPlatform;
let notices: unknown[];
let prompts: string[];
let behind: number;
let dirty: string[];
let pulls: number;
let statusHeld: boolean;
let statusHolds: number;
let chatRead: Promise<void>;

const at = (day: number, hour: number, minute = 0): Date => new Date(2026, 9, day, hour, minute);

function seedWorkstream(id: string, projectId: string, name: string): void {
	upsertWorkstream(db, {
		id,
		projectId,
		name,
		path: `/tmp/${id}`,
		branch: `malini/${id}`,
		baseBranch: 'main',
		status: 'active',
		createdAt: at(MONDAY, 0).toISOString(),
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

function harness(): MainContext {
	const commands = new CommandRegistry();
	let sessions = 0;
	commands.define('app.list-settings', () => ({}));
	commands.define('app.notification-permission-granted', () => true);
	commands.define('app.notify', (args: unknown) => {
		notices.push(args);
	});
	commands.define('chat.workstream-has-working-run', () => false);
	commands.define('chat.list-events', async () => {
		await chatRead;
		return [];
	});
	commands.define('chat.start-session', () => `session-${++sessions}`);
	commands.define('chat.send-prompt', (args: unknown) => {
		prompts.push(String(Reflect.get(Object(args), 'prompt')));
		return `agent-run-${sessions}`;
	});
	commands.define('repositories.create-workstream', (args: unknown) => {
		seedWorkstream(field(args, 'workstreamId'), 'local__acme__app', field(args, 'name'));
		return '/tmp/new-workstream';
	});
	commands.define('repositories.sync-workstream-base', () => 'current' as const);
	commands.define('repositories.provision-dependencies', () => ({ status: 'succeeded' as const }));
	commands.define('repositories.workstream-status', async () => {
		if (statusHeld) {
			statusHolds += 1;
			await new Promise(() => {});
		}
		return { ...worktree(), dirtyPaths: dirty };
	});
	commands.define('repositories.count-behind-base', () => behind);
	commands.define('repositories.pull-workstream', () => {
		pulls += 1;
		return 'abc1234';
	});
	return {
		db,
		commands,
		events: createEventBus({ forwardToWindows: false }),
		appDataRoot: '/tmp/automation-schedules-test',
		checkoutsRoot: '/tmp/automation-schedules-test',
		resourcesRoot: '/tmp/automation-schedules-test',
		isDev: true,
		appVersion: '0.0.0-test',
	};
}

function start(): void {
	context = harness();
	automations = registerAutomations(context, { log: () => {} });
	automations.start();
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
	vi.setSystemTime(at(MONDAY, 8, 59));
	db = openMigratedDatabase(':memory:');
	notices = [];
	prompts = [];
	behind = 0;
	dirty = [];
	pulls = 0;
	statusHeld = false;
	statusHolds = 0;
	chatRead = Promise.resolve();
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
	start();
});

afterEach(() => {
	automations.dispose();
	db.close();
	vi.useRealTimers();
});

function schedule(
	when: string,
	mode: AutomationTrigger['mode'] = 'auto',
): Promise<AutomationDefinitionRecord> {
	return context.commands.call('automations.save-definition', {
		name: 'Triage',
		instructions: 'Triage what came in.',
		provider: 'claude',
		model: 'opus',
		effort: 'low',
		runsIn: 'workstream',
		trigger: { when, mode },
	});
}

async function runs(): Promise<AutomationRunRecord[]> {
	return (await context.commands.call('automations.list-runs', undefined)).reverse();
}

async function passTo(time: Date): Promise<void> {
	vi.setSystemTime(time);
	await vi.advanceTimersByTimeAsync(SCHEDULE_CHECK_INTERVAL_MS);
}

function finish(run: AutomationRunRecord | undefined): void {
	if (!run?.sessionId) throw new Error('the run has no chat');
	context.events.emit(CHAT_AGENT_EVENT_CHANNEL, {
		sessionId: run.sessionId,
		runId: run.agentRunId ?? 'agent-run',
		seq: 1,
		event: { type: 'run.completed', summary: 'Nothing new.' },
	});
}

describe('automation schedules', () => {
	it('starts an automation at its time in a new workstream of its repository, once for each time it comes', async () => {
		await schedule('every weekday at 09:00 in acme/app');
		await passTo(at(MONDAY, 8, 59));
		expect(await runs()).toEqual([]);

		await passTo(at(MONDAY, 9));
		await vi.waitFor(async () =>
			expect(await runs()).toEqual([
				expect.objectContaining({ origin: 'schedule', repositoryId: 'repo-1' }),
			]),
		);
		const [run] = await runs();
		expect(getWorkstream(db, run?.workstreamId ?? '')).toMatchObject({
			projectId: 'local__acme__app',
			name: 'Triage',
		});
		expect(prompts[0]).toBe(
			'Triage what came in.\n\nMalini started this run on its schedule, every weekday at 09:00 in acme/app, due Monday, October 26 at 09:00.',
		);

		await passTo(at(MONDAY, 12));
		expect(await runs()).toHaveLength(1);
	});

	it('starts a run on the Time reached it logs, names it as the cause, and never again when it hears that time after a restart', async () => {
		const automation = await schedule('every weekday at 09:00 in acme/app');
		await passTo(at(MONDAY, 9));
		await vi.waitFor(async () => expect(await runs()).toHaveLength(1));
		const [reached] = all<{ id: number; payload: string }>(
			db,
			'SELECT id, payload FROM event_log WHERE channel = ?',
			AUTOMATIONS_TIME_REACHED_CHANNEL,
		);
		expect(JSON.parse(reached?.payload ?? 'null')).toEqual({
			definitionId: automation.id,
			name: 'Triage',
			when: 'every weekday at 09:00 in acme/app',
			due: at(MONDAY, 9).toISOString(),
		});
		const [run] = await runs();
		expect(
			all<{ event_id: number }>(
				db,
				'SELECT event_id FROM automation_run_events WHERE automation_run_id = ?',
				run?.id ?? '',
			),
		).toEqual([{ event_id: reached?.id }]);

		finish(run);
		await vi.waitFor(async () => expect((await runs())[0]?.status).toBe('succeeded'));
		automations.dispose();
		db.exec('UPDATE event_log SET handled_at = NULL');
		start();
		await vi.waitFor(() =>
			expect(all(db, 'SELECT id FROM event_log WHERE handled_at IS NULL')).toEqual([]),
		);
		await vi.advanceTimersByTimeAsync(SCHEDULE_CHECK_INTERVAL_MS);
		expect(await runs()).toHaveLength(1);
	});

	it('catches up once on the times it missed, but never on a time before it was set', async () => {
		vi.setSystemTime(at(MONDAY, 10));
		await schedule('every day at 09:00 in acme/app');
		await passTo(at(MONDAY, 10, 1));
		expect(await runs()).toEqual([]);

		await passTo(at(MONDAY + 3, 12));
		await vi.waitFor(async () =>
			expect(await runs()).toEqual([expect.objectContaining({ origin: 'schedule' })]),
		);
		const [first] = await runs();
		finish(first);
		await passTo(at(MONDAY + 4, 9));
		await vi.waitFor(async () =>
			expect((await runs())[1]).toMatchObject({ workstreamId: first?.workstreamId }),
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
		await vi.waitFor(async () => {
			const all = await runs();
			expect(all.find((run) => run.title === 'Update from main')).toMatchObject({
				origin: 'schedule',
				status: 'succeeded',
				detail: 'Merged 3 commits from main',
				workstreamId: first?.workstreamId,
			});
			expect(all.filter((run) => run.title === 'Triage').at(-1)).toMatchObject({
				status: 'running',
				workstreamId: first?.workstreamId,
			});
		});
		expect(pulls).toBe(1);
		expect(prompts[1]).not.toContain('did not merge');
		expect(JSON.stringify(notices)).not.toContain('Update from main');
	});

	it('runs on its schedule without merging main into a workstream with uncommitted changes, and says why', async () => {
		await schedule('every day at 09:00 in acme/app');
		await passTo(at(MONDAY, 9));
		await vi.waitFor(async () => expect((await runs())[0]?.status).toBe('running'));
		const [first] = await runs();
		finish(first);
		behind = 3;
		dirty = ['notes.md'];

		await passTo(at(MONDAY + 1, 9));

		await vi.waitFor(async () => expect((await runs())[1]?.status).toBe('running'));
		expect((await runs()).map((run) => run.title)).toEqual(['Triage', 'Triage']);
		expect(pulls).toBe(0);
		expect(prompts[1]).toContain(
			'Malini did not merge main into this workstream before this run: it has uncommitted changes.',
		);
	});

	it('tells you when a run waits for your yes and when it finishes', async () => {
		await schedule('every day at 09:00 in acme/app', 'ask');
		await passTo(at(MONDAY, 9));
		await vi.waitFor(() =>
			expect(notices).toEqual([
				{
					options: {
						title: 'Triage wants to run',
						body: 'It waits for your yes.',
					},
				},
			]),
		);
		const [waiting] = await runs();
		await context.commands.call('automations.confirm-run', { automationRunId: waiting?.id ?? '' });
		await vi.waitFor(async () => expect((await runs())[0]?.status).toBe('running'));
		const [running] = await runs();
		finish(running);
		await vi.waitFor(() =>
			expect(notices.at(-1)).toEqual({
				options: {
					title: 'Triage finished',
					body: 'Nothing new.',
					opens: { workstreamId: running?.workstreamId, sessionId: 'session-1' },
				},
			}),
		);
	});

	it('asks again for its next time while the last time still waits for your yes', async () => {
		await schedule('every day at 09:00 in acme/app', 'ask');
		await passTo(at(MONDAY, 9));
		await vi.waitFor(async () => expect((await runs())[0]?.status).toBe('waiting'));

		await passTo(at(MONDAY + 1, 9));

		await vi.waitFor(async () =>
			expect((await runs()).map(({ status }) => status)).toEqual(['cancelled', 'waiting']),
		);
		expect(notices).toHaveLength(2);
	});

	it('keeps the run you said yes to as its next time starts, and asks again for that time', async () => {
		await schedule('every day at 09:00 in acme/app', 'ask');
		await passTo(at(MONDAY, 9));
		await vi.waitFor(async () => expect((await runs())[0]?.status).toBe('waiting'));
		const [asked] = await runs();
		context.events.subscribe(AUTOMATIONS_RUN_CHANGED_CHANNEL, ({ run }) => {
			if (run.id !== asked?.id && run.status === 'waiting') {
				void context.commands.call('automations.confirm-run', { automationRunId: asked?.id ?? '' });
			}
		});

		await passTo(at(MONDAY + 1, 9));

		await vi.waitFor(async () =>
			expect((await runs()).map(({ status }) => status)).toEqual(['running', 'waiting']),
		);
	});

	it('keeps a due alarm while the log cannot be read, and rings it once the log can', async () => {
		const reached = {
			workstreamId: 'lead-1',
			sessionId: 'session-1',
			runId: 'run-1',
			wait: 'resume' as const,
			due: new Date(Date.now() - 1_000).toISOString(),
		};
		const heard: unknown[] = [];
		context.events.subscribe(AUTOMATIONS_TIME_REACHED_CHANNEL, (payload) => heard.push(payload));
		db.exec('ALTER TABLE event_log RENAME TO event_log_away');
		setAlarm(db, 'resume:session-1', reached);

		await vi.advanceTimersByTimeAsync(ALARM_CHECK_INTERVAL_MS);
		expect(all(db, 'SELECT key FROM alarms')).toEqual([{ key: 'resume:session-1' }]);

		db.exec('ALTER TABLE event_log_away RENAME TO event_log');
		await vi.advanceTimersByTimeAsync(ALARM_CHECK_INTERVAL_MS);
		expect(heard).toEqual([reached]);
		expect(all(db, 'SELECT key FROM alarms')).toEqual([]);
	});

	it('runs the time it missed while Malini was closed once it settles the run that closing cut', async () => {
		await schedule('every day at 09:00 in acme/app');
		await passTo(at(MONDAY, 9));
		await vi.waitFor(async () => expect((await runs())[0]?.status).toBe('running'));
		automations.dispose();
		let readChat = (): void => {};
		chatRead = new Promise((resolve) => (readChat = resolve));

		vi.setSystemTime(at(MONDAY + 1, 10));
		start();
		await vi.advanceTimersByTimeAsync(SCHEDULE_CHECK_INTERVAL_MS);
		expect((await runs()).map(({ status }) => status)).toEqual(['running']);

		readChat();
		await vi.waitFor(async () =>
			expect((await runs()).map(({ status }) => status)).toEqual(['failed', 'running']),
		);
	});

	it('starts a time once when Malini closed after it logged that time and before the run began', async () => {
		await schedule('every day at 09:00 in acme/app');
		await passTo(at(MONDAY, 9));
		await vi.waitFor(async () => expect((await runs())[0]?.status).toBe('running'));
		finish((await runs())[0]);
		await vi.waitFor(async () => expect((await runs())[0]?.status).toBe('succeeded'));
		statusHeld = true;
		await passTo(at(MONDAY + 1, 9));
		await vi.waitFor(() => expect(statusHolds).toBe(1));
		automations.dispose();

		statusHeld = false;
		vi.setSystemTime(at(MONDAY + 1, 9, 5));
		start();

		await vi.waitFor(async () => expect(await runs()).toHaveLength(2));
		await vi.advanceTimersByTimeAsync(SCHEDULE_CHECK_INTERVAL_MS);
		expect(await runs()).toHaveLength(2);
	});

	it('saves a schedule in the casing Malini knows, and refuses a place it does not know', async () => {
		expect((await schedule('every Weekday at 9:00 in ACME/App')).trigger?.when).toBe(
			'every weekday at 09:00 in acme/app',
		);
		await expect(schedule('every day at 09:00 in acme/elsewhere')).rejects.toThrow(
			/No repository in Malini is `acme\/elsewhere`/u,
		);
		await expect(schedule('every day at 09:00 in acme')).rejects.toThrow(
			/Unsupported schedule "every day at 09:00 in acme"\. Write .* followed by in <owner>\/<repository>/u,
		);
		const definitions = await context.commands.call('automations.list-definitions', undefined);
		const merge = definitions.find((definition) => definition.builtin === 'merge');
		if (!merge) throw new Error('the built-in Merge automation is missing');
		await expect(
			context.commands.call('automations.save-definition', {
				...merge,
				trigger: { when: 'every day at 09:00 in acme/app', mode: 'auto' },
			}),
		).rejects.toThrow(/never on a schedule/u);
		await expect(schedule('every day at 09:00')).rejects.toThrow(/must say where it runs/u);
	});

	it('lets the brain notes keep a schedule with no place, and no other automation', async () => {
		const definitions = await context.commands.call('automations.list-definitions', undefined);
		const notes = definitions.find((definition) => definition.builtin === 'write-brain-notes');
		if (!notes?.trigger) throw new Error('the built-in brain notes automation is missing');
		const saved = await context.commands.call('automations.save-definition', {
			...notes,
			trigger: { when: notes.trigger.when, mode: 'ask' },
		});
		expect(saved.trigger).toEqual({ when: 'every sunday at 18:00', mode: 'ask' });
	});
});
