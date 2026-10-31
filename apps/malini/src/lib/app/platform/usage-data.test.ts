import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, net: {} }));

import { CHAT_AGENT_EVENT_CHANNEL, STATS_PROFILE_PUBLISHED_CHANNEL } from '$contract/events';
import type { MainContext } from '$main/context';
import { openMigratedDatabase } from '$main/db/open';
import { HEARD_ABOUT_SETTING } from '../domain/heard-about';
import { USAGE_DATA_SETTING } from '../domain/usage-data';
import { setSetting } from './settings.repository';
import { createTestContext } from './test-support';
import { startUsageData, type UsageActivity } from './usage-data';

function harness(
	context: MainContext = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') }),
) {
	const activity: UsageActivity[] = [];
	const tags: Readonly<Record<string, string>>[] = [];
	const errors: string[] = [];
	let throwUncaught: (error: unknown) => void = () => undefined;
	let goneProcess: (process: string, reason: string, exitCode: number) => void = () => undefined;
	startUsageData(context, {
		sink: {
			activity: (name, props) => {
				activity.push(name);
				tags.push(props);
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
	});
	return {
		context,
		activity,
		tags,
		errors,
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

function publishProfile(context: MainContext): void {
	context.events.emit(STATS_PROFILE_PUBLISHED_CHANNEL, {
		handle: 'szymeo',
		public: true,
		url: 'https://bestboy.dev/@szymeo',
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

	it('tags each count with where you heard about Malini, and counts a published profile', () => {
		const { context, activity, tags } = harness();
		setSetting(context.db, HEARD_ABOUT_SETTING, 'hacker-news');
		finishRun(context, 'run.completed');
		publishProfile(context);
		expect(activity).toEqual(['app_active', 'run_finished', 'profile_published']);
		expect(tags).toEqual([{}, { heard_about: 'hacker-news' }, { heard_about: 'hacker-news' }]);
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

	it('sends nothing once the user turns usage data off', async () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		setSetting(context.db, USAGE_DATA_SETTING, 'off');
		const { activity, errors } = harness(context);
		finishRun(context, 'run.completed');
		publishProfile(context);
		await failCommand(context, new Error('disk gone'));
		expect([...activity, ...errors]).toEqual([]);
	});
});
