import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({
	fetchMock: vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response('{}'))),
}));

vi.mock('electron', () => ({ app: {}, net: { fetch: fetchMock } }));

import type { ShipStateRecord } from '$contract/pull-requests';
import {
	APP_STARTED_CHANNEL,
	CHAT_AGENT_EVENT_CHANNEL,
	CHAT_RUN_CHANGES_CAPTURED_CHANNEL,
	PULL_REQUESTS_BUTTON_CLICKED_CHANNEL,
	PULL_REQUESTS_SHIP_CHANGED_CHANNEL,
	REPOSITORIES_CHANGED_CHANNEL,
	REPOSITORIES_WORKSTREAM_CREATED_CHANNEL,
	STATS_PROFILE_PUBLISHED_CHANNEL,
} from '$contract/events';
import type { GitHubSignInOutcome } from '$contract/repositories';
import type { UsageReport, UsageStep } from '$contract/system';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { run } from '$main/db/rows';
import { HEARD_ABOUT_SETTING } from '../domain/heard-about';
import { USAGE_DATA_SETTING } from '../domain/usage-data';
import { getSetting, setSetting } from './settings.repository';
import { elapsed, gigabytes, type ErrorMoment } from './error-context';
import { createTestContext } from './test-support';
import { errorLine, logdashUserId, startUsageData, type UsageActivity } from './usage-data';
import { isUsageStep } from './usage-steps';

const NOW = new Date(2026, 9, 15, 10);

const INSTALL_ID = 'usage-data.install-id';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const LATER_DAY = { week_first: 'yes', month_first: 'yes', age: 'later' };
const FIRST_DAY = { week_first: 'yes', month_first: 'yes', age: 'day_1' };

interface HarnessOptions {
	readonly now?: () => Date;
	readonly freshInstall?: boolean;
	readonly delivered?: (name: UsageActivity | 'loop') => boolean;
	readonly published?: () => boolean;
	readonly moment?: () => ErrorMoment | null;
}

function harness(
	context: MainContext = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') }),
	account: () => string | null = () => null,
	options: HarnessOptions = {},
) {
	const activity: UsageActivity[] = [];
	const reports: UsageReport[] = [];
	const tags: Readonly<Record<string, string | number>>[] = [];
	const accounts: (string | null)[] = [];
	const errors: string[] = [];
	let throwUncaught: (error: unknown) => void = () => undefined;
	let goneProcess: (process: string, reason: string, status: number) => void = () => undefined;
	const delivered = options.delivered ?? (() => true);
	const usageData = startUsageData(context, {
		account: () => Promise.resolve(account()),
		sink: {
			activity: (name, props, carried) => {
				activity.push(name);
				tags.push(props);
				accounts.push(carried);
				return Promise.resolve(delivered(name));
			},
			report: (report, carried) => {
				reports.push(report);
				accounts.push(carried);
				return Promise.resolve(delivered('loop'));
			},
			error: (headline, details) => {
				errors.push(errorLine(headline, details));
				return Promise.resolve(true);
			},
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
		system: { app: { version: '1.0.0' } },
		moment: options.moment ?? (() => null),
		now: options.now ?? (() => NOW),
		...(options.freshInstall === undefined ? {} : { freshInstall: options.freshInstall }),
		...(options.published ? { published: options.published } : {}),
	});
	return {
		context,
		share: (shared: boolean) => usageData.share(shared),
		step: (step: UsageStep) => usageData.step(step),
		activity,
		reports,
		tags,
		accounts,
		errors,
		start: () => context.events.emit(APP_STARTED_CHANNEL, { version: '1.0.0' }),
		throwUncaught: (error: unknown) => throwUncaught(error),
		goneProcess: (process: string, reason: string, status: number) =>
			goneProcess(process, reason, status),
		shutdown: () => usageData.shutdown(),
	};
}

function splitLine(line: string): { headline: string; details: unknown } {
	const at = line.indexOf(' {');
	return { headline: line.slice(0, at), details: JSON.parse(line.slice(at + 1)) };
}

function settled(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

function finishRun(context: MainContext, type: string): void {
	context.events.emit(CHAT_AGENT_EVENT_CHANNEL, {
		sessionId: 's1',
		runId: 'r1',
		seq: 1,
		event: { type, runId: 'r1' },
	});
}

function publishProfile(context: MainContext): void {
	context.events.emit(STATS_PROFILE_PUBLISHED_CHANNEL, {
		handle: 'szymeo',
		public: true,
		url: 'https://bestboy.dev/@szymeo',
	});
}

function addRepository(context: MainContext): void {
	context.events.emit(REPOSITORIES_CHANGED_CHANNEL, {});
}

function addWorkstream(context: MainContext): void {
	context.events.emit(REPOSITORIES_WORKSTREAM_CREATED_CHANNEL, {
		workstreamId: 'ws-a',
		project: {
			id: 'p',
			name: 'p',
			repoPath: '/tmp/repo',
			defaultBranch: 'main',
			createdAt: at(1, 9),
		},
		workstream: {
			id: 'ws-a',
			projectId: 'p',
			name: 'ws-a',
			path: '/tmp/ws',
			branch: 'malini/ws',
			baseBranch: 'main',
			status: 'active',
			createdAt: at(15, 9),
			startedBy: null,
		},
	});
}

function mergeWorkstream(context: MainContext): void {
	context.events.emit(PULL_REQUESTS_SHIP_CHANGED_CHANNEL, {
		workstreamId: 'ws-a',
		state: null,
		merged: { pullRequestNumber: 7, pullRequestUrl: null },
	});
}

async function failCommand(context: MainContext, error: Error): Promise<void> {
	context.commands.define('repositories.list-workstreams', () => {
		throw error;
	});
	await context.commands.handle({ command: 'repositories.list-workstreams', args: undefined });
}

describe('usage data', () => {
	it('reports the app as active once per launch', async () => {
		const { activity } = harness();
		await settled();
		expect(activity).toEqual(['app_active', 'day']);
	});

	it('counts every run that finishes, and nothing else an agent does', async () => {
		const { context, activity } = harness();
		finishRun(context, 'run.started');
		finishRun(context, 'tool.completed');
		finishRun(context, 'run.completed');
		finishRun(context, 'run.failed');
		await settled();
		expect(activity).toEqual(['app_active', 'day', 'run_finished', 'run_finished']);
	});

	it('tags each count with where you heard about Malini, and counts a published profile', async () => {
		const { context, activity, tags } = harness();
		await settled();
		setSetting(context.db, HEARD_ABOUT_SETTING, 'hacker-news');
		finishRun(context, 'run.completed');
		publishProfile(context);
		await settled();
		expect(activity).toEqual(['app_active', 'day', 'run_finished', 'profile_published']);
		expect(tags).toEqual([
			{},
			LATER_DAY,
			{ heard_about: 'hacker-news', ending: 'succeeded' },
			{ heard_about: 'hacker-news' },
		]);
	});

	it('logs a failed command by its error name and where it was thrown, never its message', async () => {
		const { context, errors } = harness();
		const error = Object.assign(new Error('cannot read /Users/me/secret-client'), {
			code: 'ENOENT',
		});
		await failCommand(context, error);
		await settled();
		expect(errors).toEqual([
			expect.stringMatching(
				/^repositories\.list-workstreams failed: Error ENOENT \{"app":\{"version":"1\.0\.0"\},"last_commands":\["repositories\.list-workstreams"\],"stack":\["lib\/app\/platform\/usage-data\.test\.ts:\d+"\]\}$/u,
			),
		]);
	});

	it('logs a failure once at once, then how many more times it failed this launch', async () => {
		const { context, errors, shutdown } = harness();
		const error = Object.assign(new Error('nope'), { code: 'ENOENT' });
		await failCommand(context, error);
		await settled();
		for (let repeat = 0; repeat < 3; repeat += 1) {
			await context.commands.handle({ command: 'repositories.list-workstreams', args: undefined });
		}
		await settled();
		expect(errors).toHaveLength(1);
		await shutdown();
		await shutdown();
		const [first, repeats] = errors.map(splitLine);
		expect(errors).toHaveLength(2);
		expect(repeats?.headline).toBe(first?.headline);
		expect(repeats?.details).toEqual({
			app: { version: '1.0.0' },
			stack: [expect.stringMatching(/^lib\/app\/platform\/usage-data\.test\.ts:\d+$/u)],
			repeats_since_last_line: 3,
		});
	});

	it('leaves out failures Malini expects, like a signed-out GitHub', async () => {
		const { context, errors } = harness();
		await failCommand(
			context,
			Object.assign(new Error('sign in'), { name: 'GhError', kind: 'auth-required' }),
		);
		await settled();
		expect(errors).toEqual([]);
	});

	it('logs crashes and uncaught exceptions', async () => {
		const { errors, throwUncaught, goneProcess } = harness();
		throwUncaught(new TypeError('x is undefined in /Users/me'));
		goneProcess('renderer', 'killed', 9);
		await settled();
		expect(errors).toEqual([
			expect.stringMatching(
				/^uncaught exception: TypeError \{"app":\{"version":"1\.0\.0"\},"stack":\["lib\/app\/platform\/usage-data\.test\.ts:\d+"\]\}$/u,
			),
			'renderer process gone: killed, SIGKILL {"app":{"version":"1.0.0"}}',
		]);
	});

	it('adds the moment and the latest distinct commands before it, never their arguments or what it does not know', async () => {
		const moment: ErrorMoment = {
			running_for: '42m',
			memory_used: '1.3 GB',
			rendering: 'gpu',
			route: null,
			agent_runs: 2,
		};
		const { context, errors, goneProcess } = harness(undefined, () => null, {
			moment: () => moment,
		});
		context.commands.define('browser.hide', () => undefined);
		context.commands.define('browser.show', () => undefined);
		for (const command of ['browser.hide', 'browser.show', 'browser.hide'] as const)
			await context.commands.handle({ command, args: { path: '/Users/me/secret' } });
		goneProcess('GPU', 'abnormal-exit', 512);
		await settled();
		expect(errors).toEqual([
			'GPU process gone: abnormal-exit, exit 2 {"app":{"version":"1.0.0","running_for":"42m","memory_used":"1.3 GB","rendering":"gpu","agent_runs":2},"last_commands":["browser.hide","browser.show"]}',
		]);
	});

	it('names the app lines a failure passed through, thrower first', async () => {
		const { context, errors } = harness();
		const error = Object.assign(new Error('/Users/me/acme'), { name: 'GitError', kind: 'git' });
		error.stack = [
			'GitError: /Users/me/acme',
			'    at run (/a/apps/malini/src/main/git/run.ts:12:3)',
			'    at fetch (/a/apps/malini/src/main/git/remote.ts:40:1)',
		].join('\n');
		await failCommand(context, error);
		await settled();
		expect(errors).toEqual([
			'repositories.list-workstreams failed: GitError (git) {"app":{"version":"1.0.0"},"last_commands":["repositories.list-workstreams"],"stack":["main/git/run.ts:12","main/git/remote.ts:40"]}',
		]);
	});

	it('writes running time and memory the way a person reads them', () => {
		expect([61, 42 * 60, 5 * 3600, 3 * 86_400].map(elapsed)).toEqual(['61s', '42m', '5h', '3d']);
		expect([gigabytes(18 * 2 ** 30, 0), gigabytes(1.25 * 2 ** 30, 1)]).toEqual(['18 GB', '1.3 GB']);
	});

	it('names the signal or the exit code of a gone process, not its wait status', async () => {
		const { errors, goneProcess } = harness();
		goneProcess('GPU', 'crashed', 6);
		goneProcess('GPU', 'abnormal-exit', 512);
		goneProcess('Utility', 'launch-failed', 1003);
		await settled();
		expect(errors).toEqual([
			'GPU process gone: crashed, SIGABRT {"app":{"version":"1.0.0"}}',
			'GPU process gone: abnormal-exit, exit 2 {"app":{"version":"1.0.0"}}',
			'Utility process gone: launch-failed, code 1003 {"app":{"version":"1.0.0"}}',
		]);
	});

	it("reports yesterday's loop once a day: workstreams started, prompts, merges, drops, and a typical merge", async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		seedLoop(context.db);
		const first = harness(context);
		first.start();
		first.start();
		await settled();
		const second = harness(context);
		second.start();
		await settled();
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

	it("keeps yesterday's loop when its post fails, and reports it on the next check", async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		seedLoop(context.db);
		const down = harness(context, undefined, { delivered: (name) => name !== 'loop' });
		down.start();
		await settled();
		expect(down.reports).toHaveLength(1);

		const back = harness(context);
		back.start();
		await settled();
		expect(back.reports.map(({ day }) => day)).toEqual(['2026-10-14']);

		const again = harness(context);
		again.start();
		await settled();
		expect(again.reports).toEqual([]);
	});

	it('reports nothing for a day nothing happened', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		seedProject(context.db);
		seedWorkstream(context.db, 'ws-old', { createdAt: at(1, 9) });
		const { reports, start } = harness(context);
		start();
		await settled();
		expect(reports).toEqual([]);
	});

	it('carries the signed-in account, this install id signed out, and nothing once sharing is off', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		seedLoop(context.db);
		let lent: string | null = 'u1';
		let asked = 0;
		const { activity, reports, accounts, errors, start, throwUncaught } = harness(context, () => {
			asked += 1;
			return lent;
		});
		start();
		await settled();
		expect(activity).toEqual(['app_active', 'day']);
		expect(reports).toHaveLength(1);
		expect(accounts).toEqual(['u1', 'u1', 'u1']);
		expect(getSetting(context.db, INSTALL_ID)).toBeNull();

		lent = null;
		finishRun(context, 'run.completed');
		await settled();
		const install = `install:${getSetting(context.db, INSTALL_ID)}`;
		expect(accounts).toEqual(['u1', 'u1', 'u1', install]);

		setSetting(context.db, USAGE_DATA_SETTING, 'off');
		lent = 'u1';
		const askedBefore = asked;
		finishRun(context, 'run.completed');
		publishProfile(context);
		throwUncaught(new TypeError('x is undefined'));
		await settled();
		expect(accounts).toEqual(['u1', 'u1', 'u1', install]);
		expect(errors).toEqual([]);
		expect(asked).toBe(askedBefore);
	});

	it('carries one install id signed out across launches, none on stats_off, and a new one after', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		seedLoop(context.db);
		const first = harness(context);
		first.start();
		await settled();
		const id = getSetting(context.db, INSTALL_ID);
		expect(id).toMatch(UUID);
		expect(first.activity).toEqual(['app_active', 'day']);
		expect(first.reports).toHaveLength(1);

		const second = harness(context, undefined, { now: () => new Date(2026, 9, 16, 10) });
		await settled();
		expect(second.activity).toEqual(['app_active', 'day']);
		expect(new Set([...first.accounts, ...second.accounts])).toEqual(new Set([`install:${id}`]));

		second.share(false);
		await settled();
		expect(second.activity.at(-1)).toBe('stats_off');
		expect(second.accounts.at(-1)).toBeNull();
		expect(getSetting(context.db, INSTALL_ID)).toBeNull();

		second.share(true);
		finishRun(context, 'run.completed');
		await settled();
		const next = getSetting(context.db, INSTALL_ID);
		expect(next).toMatch(UUID);
		expect(next).not.toBe(id);
		expect(second.accounts.at(-1)).toBe(`install:${next}`);
	});

	it('says once that usage stats went off, with no id, and nothing after', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		let lent: string | null = 'u1';
		const { activity, tags, accounts, share } = harness(context, () => lent);
		await settled();
		share(false);
		share(false);
		finishRun(context, 'run.completed');
		await settled();
		expect(activity).toEqual(['app_active', 'day', 'stats_off']);
		expect(tags.at(-1)).toEqual({});
		expect(accounts).toEqual(['u1', 'u1', null]);

		lent = 'u1';
		share(true);
		await settled();
		expect(activity).toEqual(['app_active', 'day', 'stats_off']);
		finishRun(context, 'run.completed');
		await settled();
		expect(activity).toEqual(['app_active', 'day', 'stats_off', 'run_finished']);
	});

	it('hashes the account with the site the way Logdash joins it to the web', () => {
		expect(logdashUserId('malini-site', 'u1')).toBe(
			'02dbf6f2d7d1ac7ff4622a8900e79cd4b772cba160643291bc087b175765173d',
		);
	});

	it('sends nothing once the user turns usage data off', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		seedLoop(context.db);
		setSetting(context.db, USAGE_DATA_SETTING, 'off');
		const { activity, reports, errors, start } = harness(context);
		start();
		finishRun(context, 'run.completed');
		publishProfile(context);
		await failCommand(context, new Error('disk gone'));
		await settled();
		expect([...activity, ...reports, ...errors]).toEqual([]);
		expect(getSetting(context.db, INSTALL_ID)).toBeNull();
	});
});

describe('usage journeys', () => {
	it('opens a fresh install once, with its cohort and day zero', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		const first = harness(context, undefined, { freshInstall: true });
		await settled();
		expect(first.activity).toEqual(['app_active', 'first_open', 'day']);
		expect(first.tags[1]).toEqual({ cohort: '2026-10-15', days: 0 });
		expect(first.tags[2]).toEqual(FIRST_DAY);

		const again = harness(context, undefined, { freshInstall: true });
		await settled();
		expect(again.activity).toEqual(['app_active']);
	});

	it('never sends first_open for an install that existed before', async () => {
		const { activity } = harness();
		await settled();
		expect(activity).toEqual(['app_active', 'day']);
	});

	it('tags the first repository with where it came from', async () => {
		const sources = [
			{ source: { kind: 'local-folder', path: '/tmp/repo' }, expected: 'folder' },
			{ source: { kind: 'clone-url', url: 'https://github.com/a/b.git' }, expected: 'github' },
			{ source: { kind: 'clone-url', url: 'https://github.com/me/new.git' }, expected: 'new' },
		];
		for (const { source, expected } of sources) {
			const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
			const launched = harness(context, undefined, { freshInstall: true });
			context.commands.define('repositories.create-github-repository', () => ({
				fullName: 'me/new',
				description: null,
				cloneUrl: 'https://github.com/me/new.git',
				private: true,
				pushedAt: null,
			}));
			context.commands.define('repositories.connect', () => {
				seedProject(context.db);
				addRepository(context);
				return {
					created: true,
					repository: {
						id: 'repo',
						fullName: 'me/new',
						defaultBranch: 'main',
						localPath: null,
						remoteUrl: null,
						createdAt: at(15, 9),
					},
				};
			});
			if (expected === 'new')
				await context.commands.handle({
					command: 'repositories.create-github-repository',
					args: { owner: 'me', name: 'new', visibility: 'private' },
				});
			await context.commands.handle({ command: 'repositories.connect', args: { source } });
			await vi.waitFor(() => expect(launched.activity).toContain('first_repository'));
			expect(launched.tags[launched.activity.indexOf('first_repository')]).toEqual({
				cohort: '2026-10-15',
				days: 0,
				source: expected,
			});
		}
	});

	it('records the first repository, workstream, merge and prompt once each', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		seedProject(context.db);
		seedWorkstream(context.db, 'ws-a', { createdAt: at(15, 9) });
		const launched = harness(context, undefined, { freshInstall: true });
		await settled();
		addRepository(context);
		addRepository(context);
		addWorkstream(context);
		addWorkstream(context);
		mergeWorkstream(context);
		mergeWorkstream(context);
		seedRun(context.db, 'r1', 'ws-a', at(15, 9));
		finishRun(context, 'run.completed');
		finishRun(context, 'run.completed');
		await vi.waitFor(() => expect(launched.activity).toContain('first_repository'));
		const journeys = launched.activity.filter(
			(name) => name !== 'app_active' && name !== 'day' && name !== 'run_finished',
		);
		expect(journeys.sort()).toEqual([
			'first_merge',
			'first_open',
			'first_prompt',
			'first_repository',
			'first_workstream',
		]);
		const marker = launched.tags[launched.activity.indexOf('first_workstream')];
		expect(marker).toEqual({ cohort: '2026-10-15', days: 0 });
	});

	it('sends no merge marker when a ship changes without a merge', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		const launched = harness(context, undefined, { freshInstall: true });
		await settled();
		context.events.emit(PULL_REQUESTS_SHIP_CHANGED_CHANNEL, { workstreamId: 'ws-a', state: null });
		await settled();
		expect(launched.activity).not.toContain('first_merge');
	});

	it('records the first published profile once', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		const launched = harness(context, undefined, { freshInstall: true });
		await settled();
		publishProfile(context);
		publishProfile(context);
		await settled();
		expect(launched.activity.filter((name) => name === 'first_profile_published')).toHaveLength(1);
		expect(launched.activity.filter((name) => name === 'profile_published')).toHaveLength(2);
	});

	it('counts a workstream, a merge and a published profile made while sharing was off', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		setSetting(context.db, USAGE_DATA_SETTING, 'off');
		const launched = harness(context, undefined, { freshInstall: true, published: () => true });
		await settled();
		seedProject(context.db);
		seedProject(context.db, 'malini-lead-space');
		seedWorkstream(context.db, 'ws-retired', {
			createdAt: at(15, 9),
			projectId: 'malini-lead-space',
		});
		seedWorkstream(context.db, 'ws-a', {
			createdAt: at(15, 9),
			archivedAt: at(15, 10),
			merged: true,
		});
		publishProfile(context);
		launched.share(true);
		await vi.waitFor(() => expect(launched.activity).toContain('first_repository'));
		expect(launched.activity).toEqual(
			expect.arrayContaining(['first_workstream', 'first_merge', 'first_profile_published']),
		);
	});

	it('keeps a marker a failed post did not deliver, and sends it on the next launch', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		const down = harness(context, undefined, { freshInstall: true, delivered: () => false });
		await settled();
		expect(down.activity).toEqual(['app_active', 'first_open', 'day']);

		const back = harness(context);
		await settled();
		expect(back.activity).toEqual(['app_active', 'first_open', 'day']);

		const again = harness(context);
		await settled();
		expect(again.activity).toEqual(['app_active']);
	});

	it('records the first return on day 7 and on day 30, each once', async () => {
		const week = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		let clock = NOW;
		harness(week, undefined, { freshInstall: true, now: () => clock });
		await settled();
		clock = new Date(2026, 9, 22, 10);
		const daySeven = harness(week, undefined, { now: () => clock });
		await settled();
		expect(daySeven.activity).toEqual(['app_active', 'returned_week_1', 'day']);
		expect(daySeven.tags[daySeven.activity.indexOf('returned_week_1')]).toEqual({
			cohort: '2026-10-15',
			days: 7,
		});
		const later = harness(week, undefined, { now: () => clock });
		await settled();
		expect(later.activity).toEqual(['app_active']);

		const month = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		clock = NOW;
		harness(month, undefined, { freshInstall: true, now: () => clock });
		await settled();
		clock = new Date(2026, 10, 14, 10);
		const dayThirty = harness(month, undefined, { now: () => clock });
		await settled();
		expect(dayThirty.activity).toContain('returned_month_1');
		expect(dayThirty.activity).not.toContain('returned_week_1');
		expect(dayThirty.tags[dayThirty.activity.indexOf('returned_month_1')]).toEqual({
			cohort: '2026-10-15',
			days: 30,
		});
	});

	it('records no return after day 30', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		let clock = NOW;
		harness(context, undefined, { freshInstall: true, now: () => clock });
		await settled();
		clock = new Date(2026, 10, 15, 10);
		const late = harness(context, undefined, { now: () => clock });
		await settled();
		expect(late.activity).not.toContain('returned_week_1');
		expect(late.activity).not.toContain('returned_month_1');
		expect(late.tags[late.activity.indexOf('day')]).toEqual({
			week_first: 'yes',
			month_first: 'yes',
			age: 'later',
		});
	});
});

describe('usage days', () => {
	it('marks each local day once with the week and month it starts', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		let clock = NOW;
		const thursday = harness(context, undefined, { freshInstall: true, now: () => clock });
		await settled();
		expect(thursday.tags.at(-1)).toEqual(FIRST_DAY);

		const sameDay = harness(context, undefined, { now: () => clock });
		await settled();
		expect(sameDay.activity).toEqual(['app_active']);

		clock = new Date(2026, 9, 16, 9);
		const friday = harness(context, undefined, { now: () => clock });
		await settled();
		expect(friday.activity).toEqual(['app_active', 'returned_week_1', 'day']);
		expect(friday.tags[friday.activity.indexOf('day')]).toEqual({
			week_first: 'no',
			month_first: 'no',
			age: 'week_1',
		});

		clock = new Date(2026, 9, 19, 9);
		const monday = harness(context, undefined, { now: () => clock });
		await settled();
		expect(monday.tags[monday.activity.indexOf('day')]).toEqual({
			week_first: 'yes',
			month_first: 'no',
			age: 'week_1',
		});

		clock = new Date(2026, 10, 1, 9);
		const november = harness(context, undefined, { now: () => clock });
		await settled();
		expect(november.activity).toEqual(['app_active', 'returned_month_1', 'day']);
		expect(november.tags[november.activity.indexOf('day')]).toEqual({
			week_first: 'yes',
			month_first: 'yes',
			age: 'month_1',
		});
	});

	it('starts each week and month on the last day that went, across months and years', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		const launch = (
			day: Date,
			delivered: (name: UsageActivity | 'loop') => boolean = () => true,
		): ReturnType<typeof harness> =>
			harness(context, undefined, { now: () => day, delivered, freshInstall: true });
		const dayTags = async (launched: ReturnType<typeof harness>) => {
			await settled();
			const { week_first, month_first } = launched.tags[launched.activity.indexOf('day')] ?? {};
			return { week_first, month_first };
		};

		await dayTags(launch(new Date(2026, 9, 15, 9)));
		await dayTags(launch(new Date(2026, 9, 19, 9), (name) => name !== 'day'));
		expect(await dayTags(launch(new Date(2026, 9, 20, 9)))).toEqual({
			week_first: 'yes',
			month_first: 'no',
		});

		await dayTags(launch(new Date(2026, 9, 29, 9)));
		await dayTags(launch(new Date(2026, 10, 1, 9), (name) => name !== 'day'));
		expect(await dayTags(launch(new Date(2026, 10, 1, 10)))).toEqual({
			week_first: 'no',
			month_first: 'yes',
		});

		await dayTags(launch(new Date(2026, 11, 31, 9)));
		expect(await dayTags(launch(new Date(2027, 0, 1, 9)))).toEqual({
			week_first: 'no',
			month_first: 'yes',
		});
	});

	it('ages an existing install from its earliest project', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		seedProject(context.db);
		const launched = harness(context);
		await settled();
		expect(launched.activity).toEqual(['app_active', 'day']);
		expect(launched.tags[launched.activity.indexOf('day')]).toEqual({
			week_first: 'yes',
			month_first: 'yes',
			age: 'month_1',
		});
	});

	it('holds a journey marker while sharing is off until it can go', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		setSetting(context.db, USAGE_DATA_SETTING, 'off');
		const off = harness(context, undefined, { freshInstall: true });
		await settled();
		expect(off.activity).toEqual([]);
		off.share(true);
		await settled();
		expect(off.activity).toEqual(['first_open', 'day']);
	});

	it('counts nothing at launch while sharing is off, only the day later', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		setSetting(context.db, USAGE_DATA_SETTING, 'off');
		const off = harness(context);
		await settled();
		expect(off.activity).toEqual([]);
		off.share(true);
		await settled();
		expect(off.activity).toEqual(['day']);
	});
});

describe('the Logdash sink', () => {
	beforeEach(() => {
		vi.stubEnv('MALINI_USAGE_DATA', '');
	});

	const noHooks = {
		onUncaughtException: () => () => undefined,
		onUnhandledRejection: () => () => undefined,
	};

	it('posts the exact web event body for the new markers', async () => {
		vi.stubEnv('MAIN_VITE_LOGDASH_SITE', 'malini-site');
		vi.stubEnv('MAIN_VITE_LOGDASH_API_KEY', '');
		fetchMock.mockClear();
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		const usageData = startUsageData(context, {
			account: () => Promise.resolve('u1'),
			hooks: noHooks,
			processGone: () => undefined,
			moment: () => null,
			now: () => NOW,
			system: { app: { version: '1.0.0' } },
			freshInstall: true,
		});
		await settled();
		await usageData.shutdown();
		const posted = fetchMock.mock.calls.map(([url, init]) => ({
			url,
			origin: new Headers(init.headers).get('Origin'),
			body: JSON.parse(String(init.body)) as {
				siteId: string;
				sentAt: string;
				events: Array<Record<string, unknown>>;
			},
		}));
		expect(posted.map(({ url }) => url)).toEqual([
			'https://api.logdash.io/web_events',
			'https://api.logdash.io/web_events',
			'https://api.logdash.io/web_events',
		]);
		expect(posted.map(({ origin }) => origin)).toEqual([
			'https://app.malini',
			'https://app.malini',
			'https://app.malini',
		]);
		expect(posted.map(({ body }) => body.siteId)).toEqual([
			'malini-site',
			'malini-site',
			'malini-site',
		]);
		expect(posted.map(({ body }) => body.events[0]?.['name'])).toEqual([
			'malini_desktop_app_active',
			'malini_desktop_first_open',
			'malini_desktop_day',
		]);
		expect(posted[0]?.body.events[0]).not.toHaveProperty('props');
		expect(posted[1]?.body.events[0]).toMatchObject({
			path: '/',
			props: { cohort: '2026-10-15', days: 0 },
			userId: logdashUserId('malini-site', 'u1'),
		});
		expect(posted[2]?.body.events[0]?.['props']).toEqual(FIRST_DAY);
		context.db.close();
	});

	it('posts a marker again on the next launch when Logdash does not take it', async () => {
		vi.stubEnv('MAIN_VITE_LOGDASH_SITE', 'malini-site');
		fetchMock.mockClear();
		fetchMock.mockImplementation(() => Promise.resolve(new Response('{}', { status: 503 })));
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		const launch = async () => {
			const usageData = startUsageData(context, {
				hooks: noHooks,
				processGone: () => undefined,
				moment: () => null,
				now: () => NOW,
				system: { app: { version: '1.0.0' } },
				freshInstall: true,
			});
			await settled();
			await usageData.shutdown();
			await settled();
		};
		const names = () =>
			fetchMock.mock.calls.map(
				([, init]) =>
					(JSON.parse(String(init.body)) as { events: Array<{ name: string }> }).events[0]?.name,
			);
		await launch();
		fetchMock.mockImplementation(() => Promise.resolve(new Response('{}')));
		await launch();
		await launch();
		expect(names().filter((name) => name !== 'malini_desktop_app_active')).toEqual([
			'malini_desktop_first_open',
			'malini_desktop_day',
			'malini_desktop_first_open',
			'malini_desktop_day',
		]);
		context.db.close();
	});

	it('sends an error line with no account or install id', async () => {
		vi.stubEnv('MAIN_VITE_LOGDASH_SITE', 'malini-site');
		vi.stubEnv('MAIN_VITE_LOGDASH_API_KEY', 'key');
		fetchMock.mockClear();
		fetchMock.mockImplementation(() => Promise.resolve(new Response('{}')));
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		const usageData = startUsageData(context, {
			account: () => Promise.resolve('u1'),
			hooks: noHooks,
			processGone: (listener) => listener('GPU', 'crashed', 6),
			moment: () => null,
			now: () => NOW,
			system: { app: { version: '1.0.0' } },
		});
		await settled();
		await usageData.shutdown();
		const logged = fetchMock.mock.calls
			.filter(([url]) => String(url).endsWith('/logs'))
			.map(([, init]) => (JSON.parse(String(init.body)) as { message: string }).message);
		expect(logged).toEqual(['GPU process gone: crashed, SIGABRT {"app":{"version":"1.0.0"}}']);
		context.db.close();
	});

	it('posts signed-out counts with the hash of this install id, and stats_off with none', async () => {
		vi.stubEnv('MAIN_VITE_LOGDASH_SITE', 'malini-site');
		fetchMock.mockClear();
		fetchMock.mockImplementation(() => Promise.resolve(new Response('{}')));
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		const usageData = startUsageData(context, {
			hooks: noHooks,
			processGone: () => undefined,
			moment: () => null,
			now: () => NOW,
			system: { app: { version: '1.0.0' } },
		});
		await settled();
		const install = `install:${getSetting(context.db, INSTALL_ID)}`;
		usageData.share(false);
		await usageData.shutdown();
		const events = fetchMock.mock.calls.map(
			([, init]) =>
				(JSON.parse(String(init.body)) as { events: Array<Record<string, unknown>> }).events[0],
		);
		expect(events.map((event) => [event?.['name'], event?.['userId']])).toEqual([
			['malini_desktop_app_active', logdashUserId('malini-site', install)],
			['malini_desktop_day', logdashUserId('malini-site', install)],
			['malini_desktop_stats_off', undefined],
		]);
		context.db.close();
	});

	it('posts to the public site from a packaged or dogfood build with no site configured, never from a plain dev run', async () => {
		vi.stubEnv('MAIN_VITE_LOGDASH_SITE', '');
		vi.stubEnv('MALINI_BACKGROUND_WINDOW', '');
		const sites = async (isDev: boolean, dogfood: string): Promise<string[]> => {
			vi.stubEnv('MALINI_DOGFOOD', dogfood);
			fetchMock.mockClear();
			const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:'), isDev });
			const usageData = startUsageData(context, {
				hooks: noHooks,
				processGone: () => undefined,
				moment: () => null,
				now: () => NOW,
				system: { app: { version: '1.0.0' } },
			});
			await settled();
			await usageData.shutdown();
			context.db.close();
			return fetchMock.mock.calls.map(
				([, init]) => (JSON.parse(String(init.body)) as { siteId: string }).siteId,
			);
		};
		const site = '6ad7c3d3d519015fcd43194b';
		expect(await sites(true, '')).toEqual([]);
		expect(await sites(true, '1')).toEqual([site, site]);
		expect(await sites(false, '')).toEqual([site, site]);
	});

	it('sends nothing with MALINI_USAGE_DATA=off', async () => {
		vi.stubEnv('MAIN_VITE_LOGDASH_SITE', 'malini-site');
		vi.stubEnv('MALINI_USAGE_DATA', 'off');
		fetchMock.mockClear();
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		const usageData = startUsageData(context, {
			account: () => Promise.resolve(null),
			hooks: noHooks,
			processGone: () => undefined,
			moment: () => null,
			now: () => NOW,
			system: { app: { version: '1.0.0' } },
			freshInstall: true,
		});
		await settled();
		await usageData.shutdown();
		expect(fetchMock).not.toHaveBeenCalled();
		context.db.close();
	});

	it('sends nothing with DO_NOT_TRACK=1', async () => {
		vi.stubEnv('MAIN_VITE_LOGDASH_SITE', 'malini-site');
		vi.stubEnv('DO_NOT_TRACK', '1');
		fetchMock.mockClear();
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		const usageData = startUsageData(context, {
			account: () => Promise.resolve(null),
			hooks: noHooks,
			processGone: () => undefined,
			moment: () => null,
			now: () => NOW,
			system: { app: { version: '1.0.0' } },
			freshInstall: true,
		});
		await settled();
		await usageData.shutdown();
		expect(fetchMock).not.toHaveBeenCalled();
		context.db.close();
	});
});

function at(day: number, hour: number, minute = 0): string {
	return new Date(2026, 9, day, hour, minute).toISOString();
}

function seedProject(db: MaliniDatabase, id = 'p'): void {
	run(
		db,
		`INSERT INTO projects (id, name, repo_path, default_branch, created_at)
		 VALUES (?, ?, '/tmp/repo', 'main', ?)`,
		id,
		id,
		at(1, 9),
	);
}

function seedLoop(db: MaliniDatabase): void {
	seedProject(db);
	seedProject(db, 'malini-lead-space');
	seedWorkstream(db, 'ws-old', { createdAt: at(1, 9) });
	seedWorkstream(db, 'ws-a', { createdAt: at(14, 9), archivedAt: at(14, 10), merged: true });
	seedWorkstream(db, 'ws-b', { createdAt: at(13, 9), archivedAt: at(14, 12), merged: true });
	seedWorkstream(db, 'ws-c', { createdAt: at(14, 13), archivedAt: at(14, 14) });
	seedWorkstream(db, 'ws-retired', {
		createdAt: at(14, 9),
		projectId: 'malini-lead-space',
	});
	seedWorkstream(db, 'ws-today', { createdAt: at(15, 9) });
	seedRun(db, 'r1', 'ws-a', at(14, 9, 5));
	seedRun(db, 'r2', 'ws-a', at(14, 9, 30));
	seedRun(db, 'r3', 'ws-a', at(14, 9, 40), 'automation');
	seedRun(db, 'r4', 'ws-b', at(13, 9, 5));
	seedRun(db, 'r5', 'ws-b', at(13, 10));
	seedRun(db, 'r6', 'ws-b', at(14, 11));
	seedRun(db, 'r7', 'ws-b', at(14, 11, 30));
	seedRun(db, 'r8', 'ws-retired', at(14, 9, 10));
	seedRun(db, 'r9', 'ws-today', at(15, 9, 5));
	run(db, "UPDATE agent_runs SET automated = 1 WHERE id = 'r7'");
}

function seedWorkstream(
	db: MaliniDatabase,
	id: string,
	options: Readonly<{
		createdAt: string;
		archivedAt?: string;
		merged?: boolean;
		projectId?: string;
	}>,
): void {
	run(
		db,
		`INSERT INTO workstreams
		   (id, project_id, name, path, branch, base_branch, status, created_at,
		    archived_at, merged_pull_request_number)
		 VALUES (?, ?, ?, '/tmp/ws', 'malini/ws', 'main', ?, ?, ?, ?)`,
		id,
		options.projectId ?? 'p',
		id,
		options.archivedAt ? 'archived' : 'active',
		options.createdAt,
		options.archivedAt ?? null,
		options.merged ? 7 : null,
	);
}

function seedRun(
	db: MaliniDatabase,
	id: string,
	workstreamId: string,
	startedAt: string,
	origin: 'user' | 'automation' = 'user',
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

describe('usage tools', () => {
	type ToolRecord = Readonly<Record<string, string | number | undefined>> & { name: string };

	function tools(launched: ReturnType<typeof harness>): ToolRecord[] {
		return launched.activity.flatMap((name, index) =>
			name.startsWith('tool_') ? [{ ...launched.tags[index], name }] : [],
		);
	}

	async function call(context: MainContext, command: string): Promise<void> {
		await context.commands.handle({ command, args: undefined });
		await settled();
	}

	it('follows a tool install from the press to its outcome, and retries as new attempts', async () => {
		const launched = harness();
		let attempt = 0;
		launched.context.commands.define('providers.install-claude-code', () => {
			attempt += 1;
			if (attempt === 1) {
				throw Object.assign(new Error('Could not download Claude Code: ENOTFOUND host'), {
					name: 'ClaudeInstallError',
					kind: 'download',
					code: 'ENOTFOUND',
				});
			}
			return undefined;
		});
		await call(launched.context, 'providers.install-claude-code');
		await call(launched.context, 'providers.install-claude-code');
		expect(tools(launched)).toEqual([
			{ name: 'tool_install_started', tool: 'claude_code', attempt: 1, phase: 'setup' },
			{
				name: 'tool_install_failed',
				tool: 'claude_code',
				attempt: 1,
				seconds: 0,
				stage: 'download',
				error: 'ClaudeInstallError',
				code: 'ENOTFOUND',
				phase: 'setup',
			},
			{ name: 'tool_install_started', tool: 'claude_code', attempt: 2, phase: 'setup' },
			{
				name: 'tool_install_finished',
				tool: 'claude_code',
				attempt: 2,
				seconds: 0,
				phase: 'setup',
			},
		]);
		expect(JSON.stringify(launched.tags)).not.toContain('host');
	});

	it('counts an install whose app quit as a start with no outcome', async () => {
		const launched = harness();
		launched.context.commands.define(
			'repositories.install-github-cli',
			() => new Promise(() => {}),
		);
		void launched.context.commands.handle({
			command: 'repositories.install-github-cli',
			args: undefined,
		});
		await settled();
		expect(tools(launched).map((event) => event.name)).toEqual(['tool_install_started']);
	});

	it('follows a GitHub sign-in through the code, the wait and the outcome', async () => {
		const launched = harness();
		const outcomes: GitHubSignInOutcome[] = ['signed-in', 'cancelled'];
		launched.context.commands.define('repositories.start-github-sign-in', () => ({
			userCode: 'ABCD-1234',
			verificationUri: 'https://github.com/login/device',
		}));
		launched.context.commands.define(
			'repositories.finish-github-sign-in',
			() => outcomes.shift() ?? 'cancelled',
		);
		for (let round = 0; round < 2; round += 1) {
			await call(launched.context, 'repositories.start-github-sign-in');
			await call(launched.context, 'repositories.finish-github-sign-in');
		}
		expect(tools(launched).map(({ name, tool, attempt }) => [name, tool, attempt])).toEqual([
			['tool_sign_in_started', 'github', 1],
			['tool_sign_in_finished', 'github', 1],
			['tool_sign_in_started', 'github', 2],
			['tool_sign_in_cancelled', 'github', 2],
		]);
	});

	it('records a GitHub sign-in that shows no code as one failure', async () => {
		const launched = harness();
		launched.context.commands.define('repositories.start-github-sign-in', () => {
			throw new Error('GitHub CLI showed no sign-in code.');
		});
		await call(launched.context, 'repositories.start-github-sign-in');
		expect(tools(launched).map(({ name, stage, error }) => [name, stage, error])).toEqual([
			['tool_sign_in_started', undefined, undefined],
			['tool_sign_in_failed', 'unknown', 'Error'],
		]);
	});

	it('follows a Claude sign-in and marks it later once a prompt ran', async () => {
		const launched = harness();
		seedProject(launched.context.db);
		seedWorkstream(launched.context.db, 'ws-a', { createdAt: at(15, 9) });
		seedRun(launched.context.db, 'r1', 'ws-a', at(15, 9));
		launched.context.commands.define('providers.sign-in-to-claude', () => 'signed-in');
		await call(launched.context, 'providers.sign-in-to-claude');
		expect(tools(launched).map(({ name, tool, phase }) => [name, tool, phase])).toEqual([
			['tool_sign_in_started', 'claude_code', 'later'],
			['tool_sign_in_finished', 'claude_code', 'later'],
		]);
	});

	it('sends no tool event once the user turns usage data off', async () => {
		const launched = harness();
		launched.share(false);
		launched.context.commands.define('providers.install-claude-code', () => undefined);
		await call(launched.context, 'providers.install-claude-code');
		expect(tools(launched)).toEqual([]);
	});
});

describe('usage drop-offs', () => {
	function sent(launched: ReturnType<typeof harness>, name: UsageActivity) {
		return launched.activity.flatMap((activity, index) =>
			activity === name ? [launched.tags[index]] : [],
		);
	}

	function fresh() {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		return harness(context, undefined, { freshInstall: true });
	}

	function emitRun(context: MainContext, event: Readonly<Record<string, unknown>>): void {
		context.events.emit(CHAT_AGENT_EVENT_CHANNEL, { sessionId: 's1', runId: 'r1', seq: 1, event });
	}

	function ship(state: Partial<ShipStateRecord>): ShipStateRecord {
		return {
			workstreamId: 'ws-a',
			phase: 'draft',
			step: null,
			keep: false,
			pullRequestNumber: null,
			pullRequestUrl: null,
			needsYou: null,
			queuedAt: null,
			attempts: 0,
			checks: [],
			activeAutomationRunId: null,
			lastError: null,
			githubSaid: null,
			failures: 0,
			failedSince: null,
			nextAttemptAt: null,
			waitsFor: null,
			updatedAt: at(15, 9),
			...state,
		};
	}

	it('tells how each run ended, and why a failed one failed', async () => {
		const launched = harness();
		emitRun(launched.context, { type: 'run.completed' });
		emitRun(launched.context, {
			type: 'run.failed',
			error: 'You hit your limit',
			failure: { kind: 'usage-limit' },
		});
		emitRun(launched.context, {
			type: 'run.failed',
			error: 'Something odd',
			failure: { kind: 'new' },
		});
		emitRun(launched.context, { type: 'run.failed', error: 'cancelled' });
		emitRun(launched.context, { type: 'run.failed', error: 'limit', resumeAt: at(15, 12) });
		await settled();
		expect(sent(launched, 'run_finished')).toEqual([
			{ ending: 'succeeded' },
			{ ending: 'failed', failure: 'usage-limit' },
			{ ending: 'failed', failure: 'unknown' },
			{ ending: 'cancelled' },
			{ ending: 'interrupted' },
		]);
		expect(JSON.stringify(launched.tags)).not.toMatch(/hit your|odd/u);
	});

	it('marks the first way in once, and counts every pick, view and Back', async () => {
		const launched = fresh();
		launched.step({ step: 'picked', value: 'github' });
		launched.step({ step: 'github_view', value: 'code' });
		launched.step({ step: 'github_back', value: 'code' });
		launched.step({ step: 'picked', value: 'folder' });
		await vi.waitFor(() => expect(launched.activity).toContain('first_choice'));
		expect(sent(launched, 'first_choice')).toEqual([
			{ cohort: '2026-10-15', days: 0, choice: 'github' },
		]);
		expect(sent(launched, 'picked')).toEqual([
			{ choice: 'github', phase: 'setup' },
			{ choice: 'folder', phase: 'setup' },
		]);
		expect(sent(launched, 'github_view')).toEqual([{ view: 'code', phase: 'setup' }]);
		expect(sent(launched, 'github_back')).toEqual([{ view: 'code', phase: 'setup' }]);
	});

	it('marks the first prompt sent with what it waits for, and counts every held one', async () => {
		const launched = fresh();
		launched.step({ step: 'prompt_sent', value: 'claude_sign_in' });
		launched.step({ step: 'prompt_sent', value: 'none' });
		launched.step({ step: 'prompt_sent', value: 'setup' });
		await vi.waitFor(() => expect(launched.activity).toContain('first_prompt_sent'));
		expect(sent(launched, 'first_prompt_sent')).toEqual([
			{ cohort: '2026-10-15', days: 0, waits: 'claude_sign_in' },
		]);
		expect(sent(launched, 'prompt_held')).toEqual([
			{ waits: 'claude_sign_in', phase: 'setup' },
			{ waits: 'setup', phase: 'setup' },
		]);
	});

	it('takes only a known step with a known value from the renderer', () => {
		expect(isUsageStep({ step: 'picked', value: 'github' })).toBe(true);
		expect(isUsageStep({ step: 'github_back', value: 'loading' })).toBe(true);
		expect(isUsageStep({ step: 'github_view', value: 'loading' })).toBe(false);
		expect(isUsageStep({ step: 'picked', value: 'my-secret-repo' })).toBe(false);
		expect(isUsageStep({ step: 'typed', value: 'none' })).toBe(false);
		expect(isUsageStep(null)).toBe(false);
	});

	it('follows each setup step to its outcome with no path, and only failures once a prompt ran', async () => {
		const launched = harness();
		const { commands } = launched.context;
		commands.define('repositories.pick-folder', () => null);
		commands.define('repositories.create-repository', () => {
			throw Object.assign(new Error('clone of /Users/me/secret failed'), {
				name: 'GitError',
				kind: 'network',
				code: 'ECONNRESET',
			});
		});
		commands.define('repositories.create-workstream', () => '/Users/me/secret/ws');
		commands.define('repositories.sync-workstream-base', () => 'advanced');
		commands.define('repositories.provision-dependencies', () => ({
			status: 'skipped',
			reason: 'no-manifest',
			detail: '/Users/me/secret',
		}));
		for (const command of [
			'repositories.pick-folder',
			'repositories.create-repository',
			'repositories.create-workstream',
			'repositories.sync-workstream-base',
			'repositories.provision-dependencies',
		])
			await commands.handle({ command, args: undefined });
		seedProject(launched.context.db);
		seedWorkstream(launched.context.db, 'ws-a', { createdAt: at(15, 9) });
		seedRun(launched.context.db, 'r1', 'ws-a', at(15, 9));
		await commands.handle({ command: 'repositories.create-workstream', args: undefined });
		await commands.handle({ command: 'repositories.create-repository', args: undefined });
		await settled();
		expect(sent(launched, 'setup_step')).toEqual([
			{ step: 'pick_folder', outcome: 'cancelled', seconds: 0, phase: 'setup' },
			{
				step: 'clone',
				outcome: 'failed',
				seconds: 0,
				error: 'GitError',
				stage: 'network',
				code: 'ECONNRESET',
				phase: 'setup',
			},
			{ step: 'workstream', outcome: 'ok', seconds: 0, phase: 'setup' },
			{ step: 'sync_base', outcome: 'advanced', seconds: 0, phase: 'setup' },
			{
				step: 'dependencies',
				outcome: 'skipped',
				seconds: 0,
				reason: 'no-manifest',
				phase: 'setup',
			},
			{
				step: 'clone',
				outcome: 'failed',
				seconds: 0,
				error: 'GitError',
				stage: 'network',
				code: 'ECONNRESET',
				phase: 'later',
			},
		]);
		expect(JSON.stringify(launched.tags)).not.toContain('secret');
	});

	it('marks the first prompt run that changed files, never one that changed nothing', async () => {
		const launched = fresh();
		const { db } = launched.context;
		seedProject(db);
		seedWorkstream(db, 'ws-a', { createdAt: at(15, 9) });
		seedRun(db, 'r1', 'ws-a', at(15, 9));
		seedChanges(db, 'r1', 'ws-a', []);
		launched.context.events.emit(CHAT_RUN_CHANGES_CAPTURED_CHANNEL, {
			sessionId: 's-r1',
			runId: 'r1',
		});
		await settled();
		expect(launched.activity).not.toContain('first_changes');
		seedRun(db, 'r2', 'ws-a', at(15, 9, 30));
		seedChanges(db, 'r2', 'ws-a', ['src/app.ts']);
		launched.context.events.emit(CHAT_RUN_CHANGES_CAPTURED_CHANNEL, {
			sessionId: 's-r2',
			runId: 'r2',
		});
		launched.context.events.emit(CHAT_RUN_CHANGES_CAPTURED_CHANNEL, {
			sessionId: 's-r2',
			runId: 'r2',
		});
		await vi.waitFor(() => expect(launched.activity).toContain('first_changes'));
		expect(sent(launched, 'first_changes')).toEqual([{ cohort: '2026-10-15', days: 0 }]);
	});

	it('follows a ship from the first press to its pull request, and each new block once', async () => {
		const launched = fresh();
		const { events } = launched.context;
		events.emit(PULL_REQUESTS_BUTTON_CLICKED_CHANNEL, {
			workstreamId: 'ws-a',
			button: 'draft',
			state: null,
		});
		events.emit(PULL_REQUESTS_SHIP_CHANGED_CHANNEL, {
			workstreamId: 'ws-a',
			state: ship({ phase: 'needs-you', waitsFor: 'workflow-scope' }),
		});
		events.emit(PULL_REQUESTS_SHIP_CHANGED_CHANNEL, {
			workstreamId: 'ws-a',
			state: ship({ phase: 'needs-you', waitsFor: 'workflow-scope' }),
		});
		events.emit(PULL_REQUESTS_SHIP_CHANGED_CHANNEL, {
			workstreamId: 'ws-a',
			state: ship({ pullRequestNumber: 7 }),
		});
		events.emit(PULL_REQUESTS_BUTTON_CLICKED_CHANNEL, {
			workstreamId: 'ws-a',
			button: 'merge',
			state: null,
		});
		events.emit(PULL_REQUESTS_SHIP_CHANGED_CHANNEL, {
			workstreamId: 'ws-a',
			state: ship({
				phase: 'needs-you',
				pullRequestNumber: 7,
				needsYou: { reason: 'merge-not-permitted', detail: 'secret', automationRunId: null },
			}),
		});
		events.emit(PULL_REQUESTS_SHIP_CHANGED_CHANNEL, {
			workstreamId: 'ws-a',
			state: ship({ phase: 'queued', step: 'fixing-checks', pullRequestNumber: 7, failures: 2 }),
		});
		await vi.waitFor(() => expect(launched.activity).toContain('first_pull_request'));
		expect(sent(launched, 'ship_button')).toEqual([
			{ button: 'draft', phase: 'setup' },
			{ button: 'merge', phase: 'setup' },
		]);
		expect(sent(launched, 'first_ship')).toEqual([
			{ cohort: '2026-10-15', days: 0, button: 'draft' },
		]);
		expect(sent(launched, 'first_pull_request')).toEqual([{ cohort: '2026-10-15', days: 0 }]);
		expect(sent(launched, 'ship_blocked')).toEqual([
			{ by: 'waits_for', reason: 'workflow-scope', phase: 'setup' },
			{ by: 'needs_you', reason: 'merge-not-permitted', phase: 'setup' },
			{ by: 'failing', reason: 'fixing-checks', phase: 'setup' },
		]);
		expect(JSON.stringify(launched.tags)).not.toContain('secret');
	});
});

function seedChanges(
	db: MaliniDatabase,
	runId: string,
	workstreamId: string,
	paths: readonly string[],
): void {
	run(
		db,
		`INSERT INTO agent_checkpoints (id, workstream_id, session_id, run_id, git_ref, git_commit, created_at)
		 VALUES (?, ?, ?, ?, ?, 'before', ?)`,
		`checkpoint-${runId}`,
		workstreamId,
		`s-${runId}`,
		runId,
		`refs/malini/checkpoints/${runId}`,
		at(15, 9),
	);
	run(
		db,
		`INSERT INTO agent_run_changes (run_id, checkpoint_id, before_commit, after_commit, after_ref, captured_at)
		 VALUES (?, ?, 'before', 'after', ?, ?)`,
		runId,
		`checkpoint-${runId}`,
		`refs/malini/changes/${runId}`,
		at(15, 9),
	);
	for (const path of paths)
		run(
			db,
			`INSERT INTO agent_run_change_files (run_id, path, additions, deletions, is_binary)
			 VALUES (?, ?, 1, 0, 0)`,
			runId,
			path,
		);
}
