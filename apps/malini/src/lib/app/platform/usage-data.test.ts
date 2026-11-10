import { describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({
	fetchMock: vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response('{}'))),
}));

vi.mock('electron', () => ({ app: {}, net: { fetch: fetchMock } }));

import {
	APP_STARTED_CHANNEL,
	CHAT_AGENT_EVENT_CHANNEL,
	PULL_REQUESTS_SHIP_CHANGED_CHANNEL,
	REPOSITORIES_CHANGED_CHANNEL,
	REPOSITORIES_WORKSTREAM_CREATED_CHANNEL,
	STATS_PROFILE_PUBLISHED_CHANNEL,
} from '$contract/events';
import type { GitHubSignInOutcome } from '$contract/repositories';
import type { UsageReport } from '$contract/system';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { run } from '$main/db/rows';
import type { UsageAccount } from '$lib/stats/stats.platform';
import { HEARD_ABOUT_SETTING } from '../domain/heard-about';
import { ONBOARDING_FINISHED_SETTING } from '../domain/onboarding';
import { USAGE_DATA_SETTING } from '../domain/usage-data';
import { getSetting, setSetting } from './settings.repository';
import { createTestContext } from './test-support';
import { logdashUserId, startUsageData, type UsageActivity } from './usage-data';

const NOW = new Date(2026, 9, 15, 10);

const LATER_DAY = { week_first: 'yes', month_first: 'yes', age: 'later' };
const FIRST_DAY = { week_first: 'yes', month_first: 'yes', age: 'day_1' };

interface HarnessOptions {
	readonly now?: () => Date;
	readonly freshInstall?: boolean;
}

function harness(
	context: MainContext = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') }),
	account: () => UsageAccount = () => ({ state: 'anonymous' }),
	options: HarnessOptions = {},
) {
	const activity: UsageActivity[] = [];
	const reports: UsageReport[] = [];
	const tags: Readonly<Record<string, string | number>>[] = [];
	const accounts: (string | null)[] = [];
	const errors: string[] = [];
	let throwUncaught: (error: unknown) => void = () => undefined;
	let goneProcess: (process: string, reason: string, exitCode: number) => void = () => undefined;
	const usageData = startUsageData(context, {
		account: () => Promise.resolve(account()),
		sink: {
			activity: (name, props, carried) => {
				activity.push(name);
				tags.push(props);
				accounts.push(carried);
			},
			report: (report, carried) => {
				reports.push(report);
				accounts.push(carried);
			},
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
		now: options.now ?? (() => NOW),
		...(options.freshInstall === undefined ? {} : { freshInstall: options.freshInstall }),
	});
	return {
		context,
		share: (shared: boolean) => usageData.share(shared),
		journey: (
			marker: Parameters<typeof usageData.journey>[0],
			details?: Parameters<typeof usageData.journey>[1],
		) => usageData.journey(marker, details),
		activity,
		reports,
		tags,
		accounts,
		errors,
		start: () => context.events.emit(APP_STARTED_CHANNEL, { version: '1.0.0' }),
		throwUncaught: (error: unknown) => throwUncaught(error),
		goneProcess: (process: string, reason: string) => goneProcess(process, reason, 9),
	};
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
			{ heard_about: 'hacker-news' },
			{ heard_about: 'hacker-news' },
		]);
	});

	it('logs a failed command by its error name, never its message, once per launch', async () => {
		const { context, errors } = harness();
		const error = Object.assign(new Error('cannot read /Users/me/secret-client'), {
			code: 'ENOENT',
		});
		await failCommand(context, error);
		await context.commands.handle({ command: 'repositories.list-workstreams', args: undefined });
		await settled();
		expect(errors).toEqual(['repositories.list-workstreams failed: Error ENOENT · malini 1.0.0']);
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
		goneProcess('renderer', 'oom');
		await settled();
		expect(errors).toEqual([
			'uncaught exception: TypeError · malini 1.0.0',
			'renderer process gone: oom, exit 9 · malini 1.0.0',
		]);
	});

	it("reports yesterday's loop once a day: workstreams started, prompts, merges, drops, and a typical merge", async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		seedLoop(context.db);
		const first = harness(context);
		first.start();
		first.start();
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

	it('reports nothing for a day nothing happened', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		seedProject(context.db);
		seedWorkstream(context.db, 'ws-old', { createdAt: at(1, 9) });
		const { reports, start } = harness(context);
		start();
		await settled();
		expect(reports).toEqual([]);
	});

	it('carries the account only on current terms, sends no id signed out, and nothing at all on old terms', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		seedLoop(context.db);
		let lent: UsageAccount = { state: 'accepted', userId: 'u1' };
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

		lent = { state: 'anonymous' };
		finishRun(context, 'run.completed');
		await settled();
		expect(accounts).toEqual(['u1', 'u1', 'u1', null]);

		lent = { state: 'old-terms' };
		finishRun(context, 'run.completed');
		publishProfile(context);
		throwUncaught(new TypeError('x is undefined'));
		await settled();
		expect(activity).toEqual(['app_active', 'day', 'run_finished']);
		expect(accounts).toEqual(['u1', 'u1', 'u1', null]);
		expect(errors).toEqual([]);

		setSetting(context.db, USAGE_DATA_SETTING, 'off');
		lent = { state: 'accepted', userId: 'u1' };
		const askedBefore = asked;
		finishRun(context, 'run.completed');
		publishProfile(context);
		await settled();
		expect(accounts).toEqual(['u1', 'u1', 'u1', null]);
		expect(asked).toBe(askedBefore);
	});

	it('says once that usage stats went off, with no id even on old terms, and nothing after', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		let lent: UsageAccount = { state: 'accepted', userId: 'u1' };
		const { activity, tags, accounts, share } = harness(context, () => lent);
		await settled();
		lent = { state: 'old-terms' };
		share(false);
		share(false);
		finishRun(context, 'run.completed');
		await settled();
		expect(activity).toEqual(['app_active', 'day', 'stats_off']);
		expect(tags.at(-1)).toEqual({});
		expect(accounts).toEqual(['u1', 'u1', null]);

		lent = { state: 'accepted', userId: 'u1' };
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

	it('records each setup step once, with both tool states on the first', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		const launched = harness(context, undefined, { freshInstall: true });
		await settled();
		launched.journey('setup_tools', { claude_code: 'missing', github: 'ready' });
		launched.journey('setup_tools', { claude_code: 'ready', github: 'ready' });
		launched.journey('setup_sounds');
		launched.journey('setup_defaults');
		launched.journey('setup_heard_about');
		await settled();
		const steps = launched.activity.filter((name) => name.startsWith('setup_'));
		expect(steps).toEqual(['setup_tools', 'setup_sounds', 'setup_defaults', 'setup_heard_about']);
		expect(launched.tags[launched.activity.indexOf('setup_tools')]).toEqual({
			cohort: '2026-10-15',
			days: 0,
			setup_seconds: 0,
			claude_code: 'missing',
			github: 'ready',
		});
		expect(launched.tags[launched.activity.indexOf('setup_sounds')]).toEqual({
			cohort: '2026-10-15',
			days: 0,
			setup_seconds: 0,
		});
	});

	it('times each setup step from the moment the tools step first showed', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		let clock = NOW;
		const launched = harness(context, undefined, { freshInstall: true, now: () => clock });
		await settled();
		launched.journey('setup_tools', { claude_code: 'missing', github: 'missing' });
		await settled();
		clock = new Date(NOW.getTime() + 95_000);
		launched.journey('setup_sounds');
		await settled();
		clock = new Date(NOW.getTime() + 140_000);
		launched.journey('setup_defaults');
		await settled();
		setSetting(
			context.db,
			ONBOARDING_FINISHED_SETTING,
			new Date(NOW.getTime() + 200_000).toISOString(),
		);
		clock = new Date(NOW.getTime() + 3_600_000);
		launched.journey('setup_finished');
		await settled();
		const seconds = (name: UsageActivity): unknown =>
			launched.tags[launched.activity.indexOf(name)]?.['setup_seconds'];
		expect([
			seconds('setup_tools'),
			seconds('setup_sounds'),
			seconds('setup_defaults'),
			seconds('setup_finished'),
		]).toEqual([0, 95, 140, 200]);
	});

	it('sends no setup time for an install that never showed the tools step', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		const launched = harness(context, undefined, { freshInstall: true });
		await settled();
		launched.journey('setup_sounds');
		await settled();
		expect(launched.tags[launched.activity.indexOf('setup_sounds')]).toEqual({
			cohort: '2026-10-15',
			days: 0,
		});
	});

	it('sends setup_finished once, when onboarding finishes', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		const launched = harness(context, undefined, { freshInstall: true });
		await settled();
		setSetting(context.db, ONBOARDING_FINISHED_SETTING, at(15, 10));
		launched.journey('setup_finished');
		launched.journey('setup_finished');
		await settled();
		expect(launched.activity).toEqual(['app_active', 'first_open', 'day', 'setup_finished']);
		expect(launched.tags.at(-1)).toEqual({ cohort: '2026-10-15', days: 0 });
	});

	it('sends setup_finished at launch when onboarding finished off screen', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		const first = harness(context, undefined, { freshInstall: true });
		await settled();
		setSetting(context.db, ONBOARDING_FINISHED_SETTING, at(15, 10));
		const second = harness(context);
		await settled();
		expect(first.activity).toEqual(['app_active', 'first_open', 'day']);
		expect(second.activity).toEqual(['app_active', 'setup_finished']);
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

describe('usage days and months', () => {
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
		expect(november.activity).toEqual(['app_active', 'returned_month_1', 'month', 'day']);
		expect(november.tags[november.activity.indexOf('day')]).toEqual({
			week_first: 'yes',
			month_first: 'yes',
			age: 'month_1',
		});
	});

	it('reports the last active month once, with its active days, then forgets them', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		let clock = NOW;
		const firstDay = harness(context, undefined, { freshInstall: true, now: () => clock });
		await settled();
		expect(firstDay.activity).toEqual(['app_active', 'first_open', 'day']);

		clock = new Date(2026, 9, 16, 9);
		harness(context, undefined, { now: () => clock });
		await settled();

		clock = new Date(2026, 10, 1, 9);
		const november = harness(context, undefined, { now: () => clock });
		await settled();
		expect(november.activity).toEqual(['app_active', 'returned_month_1', 'month', 'day']);
		expect(november.tags[november.activity.indexOf('month')]).toEqual({
			month: '2026-10',
			active_days: 2,
		});
		expect(getSetting(context.db, 'usage-data.active-days')).toBe('["2026-11-01"]');

		const again = harness(context, undefined, { now: () => clock });
		await settled();
		expect(again.activity).toEqual(['app_active']);

		clock = new Date(2026, 10, 2, 9);
		const nextDay = harness(context, undefined, { now: () => clock });
		await settled();
		expect(nextDay.activity).toEqual(['app_active', 'day']);

		clock = new Date(2026, 11, 1, 9);
		const december = harness(context, undefined, { now: () => clock });
		await settled();
		expect(december.activity).toEqual(['app_active', 'month', 'day']);
		expect(december.tags[december.activity.indexOf('month')]).toEqual({
			month: '2026-11',
			active_days: 2,
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

	it('sends no journey marker on old terms, then sends it once accepted', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		const old = harness(context, () => ({ state: 'old-terms' }), { freshInstall: true });
		await settled();
		expect(old.activity).toEqual([]);

		const accepted = harness(context, () => ({ state: 'accepted', userId: 'u1' }));
		await settled();
		expect(accepted.activity).toEqual(['app_active', 'first_open', 'day']);
		expect(accepted.accounts).toEqual(['u1', 'u1', 'u1']);
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
			account: () => Promise.resolve({ state: 'accepted', userId: 'u1' }),
			hooks: noHooks,
			processGone: () => undefined,
			now: () => NOW,
			system: 'malini 1.0.0',
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

	it('sends nothing with MALINI_USAGE_DATA=off', async () => {
		vi.stubEnv('MAIN_VITE_LOGDASH_SITE', 'malini-site');
		vi.stubEnv('MALINI_USAGE_DATA', 'off');
		fetchMock.mockClear();
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		const usageData = startUsageData(context, {
			account: () => Promise.resolve({ state: 'anonymous' }),
			hooks: noHooks,
			processGone: () => undefined,
			now: () => NOW,
			system: 'malini 1.0.0',
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
			account: () => Promise.resolve({ state: 'anonymous' }),
			hooks: noHooks,
			processGone: () => undefined,
			now: () => NOW,
			system: 'malini 1.0.0',
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

	it('follows a Claude sign-in and marks it later once setup is over', async () => {
		const launched = harness();
		setSetting(launched.context.db, ONBOARDING_FINISHED_SETTING, at(15, 9));
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
