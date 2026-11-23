import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandName } from '$contract/commands';
import type { WidgetBoard, WidgetReading } from '$contract/widgets';
import type { MainContext } from '$main/context';
import { openMigratedDatabase } from '$main/db/open';
import { canonicalJson } from '$main/db/rows';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import type { GhResult } from '$main/process/gh';
import { createNodeProcessRunner } from '$main/process/runner';
import { upsertProject, upsertWorkstream } from '$shared/repositories/repositories.platform';
import { registerWidgets, type WidgetsPlatform } from './register';

const NOW = '2026-11-22T00:00:00.000Z';
const WORKSTREAM = 'ws-1';

let context: MainContext;
let checkout: string;
let widgets: WidgetsPlatform;
let ghAnswer: (args: readonly string[]) => GhResult;
const gh = vi.fn(async (args: readonly string[], _options?: { cwd?: string; timeoutMs?: number }) =>
	ghAnswer(args),
);
const log = vi.fn((_line: string) => undefined);

beforeEach(() => {
	checkout = mkdtempSync(join(tmpdir(), 'malini-widgets-'));
	execFileSync('git', ['init', '-q', '-b', 'main', checkout]);
	execFileSync('git', [
		'-C',
		checkout,
		'remote',
		'add',
		'origin',
		'https://github.com/bestboyhq/malini.git',
	]);
	context = {
		db: openMigratedDatabase(':memory:'),
		commands: new CommandRegistry(),
		events: createEventBus({ forwardToWindows: false }),
		appDataRoot: checkout,
		checkoutsRoot: checkout,
		resourcesRoot: checkout,
		isDev: false,
		appVersion: '0.0.0',
	};
	context.commands.define('repositories.github-auth-status', async () => ({
		authenticated: true,
		installed: true,
		login: 'szymeo',
		host: 'github.com',
		message: null,
	}));
	upsertProject(context.db, {
		id: 'project',
		name: 'malini',
		repoPath: checkout,
		defaultBranch: 'main',
		createdAt: NOW,
	});
	upsertWorkstream(context.db, {
		id: WORKSTREAM,
		projectId: 'project',
		name: WORKSTREAM,
		path: checkout,
		branch: `malini/${WORKSTREAM}`,
		baseBranch: 'main',
		status: 'active',
		createdAt: NOW,
		startedBy: null,
	});
	ghAnswer = () => ({ stdout: JSON.stringify({ value: 7, caption: 'runs' }), stderr: '', code: 0 });
	gh.mockClear();
	log.mockClear();
	widgets = register();
});

afterEach(() => {
	widgets.dispose();
	context.db.close();
	rmSync(checkout, { recursive: true, force: true });
});

function register(): WidgetsPlatform {
	return registerWidgets(context, {
		checkouts: { resolveCheckout: async () => checkout },
		gh,
		runner: createNodeProcessRunner(),
		environment: () => ({ PATH: process.env['PATH'] ?? '/usr/bin:/bin', SHELL: '/bin/sh' }),
		secrets: { valuesReaching: () => ({ ROOMS_TOKEN: 'sekret' }) },
		log,
		eventDebounceMs: 10,
	});
}

function widgetFile(id: string, file: unknown): void {
	mkdirSync(join(checkout, '.malini', 'widgets'), { recursive: true });
	const text = typeof file === 'string' ? file : JSON.stringify(file);
	writeFileSync(join(checkout, '.malini', 'widgets', `${id}.json`), text);
}

function call<Name extends CommandName>(
	command: Name,
	args: Record<string, unknown>,
): Promise<unknown> {
	return context.commands.invoke({ command, args });
}

function board(): Promise<WidgetBoard> {
	return context.commands.call('widgets.board', { workstreamId: WORKSTREAM });
}

function refresh(widgetId: string): Promise<WidgetReading> {
	return context.commands.call('widgets.refresh', { workstreamId: WORKSTREAM, widgetId });
}

function place(widgetId: string, index: number | null = null): Promise<WidgetBoard> {
	return context.commands.call('widgets.place', {
		workstreamId: WORKSTREAM,
		widgetId,
		index,
		span: null,
	});
}

function runs(): number {
	try {
		return readFileSync(join(checkout, 'runs.log'), 'utf8').split('\n').length - 1;
	} catch {
		return 0;
	}
}

const DEPLOY = {
	title: 'Deploy',
	icon: 'route',
	source: { github: 'repos/{owner}/{repo}/actions/runs?per_page=12', select: '{value: 1}' },
	refresh: { every: 5, on: ['repositories:changed', 'nope:never', 'widgets:board-changed'] },
	url: 'https://github.com/bestboyhq/malini/actions',
	author: 'aleksander',
};

describe('widget files', () => {
	it('reads good files strictly, skips each broken one once, and adds the plan to a GitHub board', async () => {
		widgetFile('deploy', DEPLOY);
		widgetFile('rooms', { title: 'Rooms', scope: 'own', source: { command: 'node rooms.mjs' } });
		widgetFile('broken', '{ not json');
		widgetFile('Bad_Name', { title: 'Bad', source: { command: 'true' } });
		widgetFile('escape', { title: 'Escape', source: { github: 'repos/../../user' } });
		widgetFile('elsewhere', { title: 'Elsewhere', source: { github: 'https://evil.dev/x' } });
		widgetFile('ftp', { title: 'Ftp', source: { command: 'true' }, url: 'ftp://x.dev' });
		widgetFile('both', { title: 'Both', source: { command: 'true', github: 'user' } });

		const first = await board();
		await board();

		expect(first.board).toBe('bestboyhq/malini');
		expect(first.me).toBe('szymeo');
		expect(first.widgets.map(({ id }) => id)).toEqual(['plan', 'deploy', 'rooms']);
		const source = {
			kind: 'github',
			path: 'repos/{owner}/{repo}/actions/runs?per_page=12',
			select: '{value: 1}',
		};
		expect(first.widgets[1]).toEqual({
			id: 'deploy',
			title: 'Deploy',
			icon: 'route',
			scope: 'shared',
			source,
			refresh: { everySeconds: 15, on: ['repositories:changed'] },
			size: 'small',
			url: 'https://github.com/bestboyhq/malini/actions',
			author: 'aleksander',
			fingerprint: createHash('sha256').update(canonicalJson(source)).digest('hex'),
			path: '.malini/widgets/deploy.json',
		});
		expect(first.widgets[2]).toMatchObject({
			scope: 'own',
			source: { kind: 'command', run: 'node rooms.mjs' },
			refresh: { everySeconds: 300, on: [] },
		});
		expect(first.widgets[0]).toMatchObject({ source: { kind: 'plan' }, path: null });
		expect(log).toHaveBeenCalledTimes(6);
	});

	it('starts a board once with the plan placed large, and keeps it off once removed', async () => {
		expect((await board()).placements).toEqual([
			{ widgetId: 'plan', span: { columns: 12, rows: 2 }, approved: true },
		]);
		await context.commands.call('widgets.remove', { workstreamId: WORKSTREAM, widgetId: 'plan' });
		expect((await board()).placements).toEqual([]);
	});

	it('places, moves, resizes and hides widgets, and refuses bad arguments', async () => {
		widgetFile('deploy', DEPLOY);
		widgetFile('rooms', { title: 'Rooms', source: { command: 'true' }, size: 'medium' });
		await place('deploy');
		await place('rooms', 0);
		const moved = await place('deploy', 0);
		expect(moved.placements.map(({ widgetId, span }) => [widgetId, span])).toEqual([
			['deploy', { columns: 1, rows: 1 }],
			['rooms', { columns: 2, rows: 1 }],
			['plan', { columns: 12, rows: 2 }],
		]);
		const resized = await context.commands.call('widgets.resize', {
			workstreamId: WORKSTREAM,
			widgetId: 'rooms',
			span: { columns: 3, rows: 4 },
		});
		expect(resized.placements[1]).toEqual({
			widgetId: 'rooms',
			span: { columns: 3, rows: 4 },
			approved: true,
		});
		expect((await place('rooms', 0)).placements[0]?.span).toEqual({ columns: 3, rows: 4 });
		const hidden = await context.commands.call('widgets.hide', {
			workstreamId: WORKSTREAM,
			widgetId: 'deploy',
		});
		expect(hidden.placements.map(({ widgetId }) => widgetId)).toEqual(['rooms', 'plan']);
		expect(hidden.hidden).toEqual(['deploy']);
		expect((await place('deploy')).hidden).toEqual([]);

		const refused = (field: string) => ({ ok: false, error: expect.stringContaining(field) });
		const workstreamId = WORKSTREAM;
		await expect(
			call('widgets.place', { workstreamId, widgetId: 'Nope', index: null, span: null }),
		).resolves.toMatchObject(refused('widgetId'));
		await expect(
			call('widgets.place', { workstreamId, widgetId: 'deploy', index: -1, span: null }),
		).resolves.toMatchObject(refused('index'));
		await expect(
			call('widgets.place', { workstreamId, widgetId: 'deploy', index: null, span: 'large' }),
		).resolves.toMatchObject(refused('span'));
		for (const span of [
			{ columns: 13, rows: 1 },
			{ columns: 0, rows: 1 },
			{ columns: 1.5, rows: 1 },
			{ columns: 1 },
		]) {
			await expect(
				call('widgets.resize', { workstreamId, widgetId: 'rooms', span }),
			).resolves.toMatchObject(refused('span'));
		}
		await expect(
			call('widgets.place', { workstreamId, widgetId: 'gone', index: null, span: null }),
		).resolves.toMatchObject(refused('No widget `gone`'));
		await expect(call('widgets.watch', { workstreamId, watching: 'yes' })).resolves.toMatchObject(
			refused('watching'),
		);
		await expect(call('widgets.board', { workstreamId: '' })).resolves.toMatchObject(
			refused('workstreamId'),
		);
	});
});

describe('trust', () => {
	it('runs a command only once it is placed with the source it approved', async () => {
		const run = 'echo ran >> runs.log; printf \'{"value": 3, "caption": "%s"}\' "$ROOMS_TOKEN"';
		widgetFile('rooms', { title: 'Rooms', source: { command: run } });

		expect((await board()).placements.map(({ widgetId }) => widgetId)).toEqual(['plan']);
		expect(await refresh('rooms')).toMatchObject({ data: null, attemptedAt: null });
		expect(runs()).toBe(0);

		expect((await place('rooms')).placements[1]).toEqual({
			widgetId: 'rooms',
			span: { columns: 1, rows: 1 },
			approved: true,
		});
		expect((await refresh('rooms')).data).toMatchObject({ value: 3, caption: 'sekret' });
		expect(runs()).toBe(1);

		widgetFile('rooms', { title: 'Rooms', source: { command: `${run}; echo more` } });
		expect((await board()).placements[1]).toMatchObject({ widgetId: 'rooms', approved: false });
		expect((await refresh('rooms')).data).toMatchObject({ value: 3 });
		expect(runs()).toBe(1);

		await place('rooms');
		expect((await refresh('rooms')).error).toBe('The source did not print JSON.');
		expect(runs()).toBe(2);
	});

	it('stops a command that prints too much, and reads a GitHub suggestion without approval', async () => {
		widgetFile('flood', { title: 'Flood', source: { command: 'yes | head -c 300000' } });
		widgetFile('deploy', DEPLOY);
		await place('flood');

		expect((await refresh('flood')).error).toBe('The command printed more than 256 KB.');
		expect((await refresh('deploy')).data).toMatchObject({ value: 7, caption: 'runs' });
		expect(gh).toHaveBeenCalledWith(
			[
				'api',
				'--method',
				'GET',
				'repos/{owner}/{repo}/actions/runs?per_page=12',
				'--jq',
				'{value: 1}',
			],
			{ cwd: checkout, timeoutMs: 20_000 },
		);
	});
});

describe('readings', () => {
	it('keeps the last good data through a failed read and a restart', async () => {
		widgetFile('deploy', DEPLOY);
		const good = await refresh('deploy');
		expect(good).toMatchObject({ data: { value: 7 }, error: null, reading: false });

		ghAnswer = () => ({ stdout: '', stderr: 'gh: Server Error (HTTP 502)\n', code: 1 });
		const failed = await refresh('deploy');
		expect(failed).toMatchObject({ data: { value: 7 }, error: 'gh: Server Error (HTTP 502)' });
		expect(failed.readAt).toBe(good.readAt);

		ghAnswer = () => ({ stdout: 'null', stderr: '', code: 0 });
		expect(await refresh('deploy')).toMatchObject({
			data: { value: 7 },
			error: 'The source printed JSON, but not an object.',
		});

		widgets.dispose();
		context = { ...context, commands: new CommandRegistry() };
		context.commands.define('repositories.github-auth-status', async () => ({
			authenticated: false,
			installed: true,
			login: null,
			host: 'github.com',
			message: 'Not signed in',
		}));
		widgets = register();
		const restarted = await board();
		expect(restarted.me).toBeNull();
		expect(restarted.readings).toEqual([
			expect.objectContaining({ widgetId: 'deploy', data: expect.objectContaining({ value: 7 }) }),
		]);
	});

	it('reads one widget once at a time and tells the board when a read starts and ends', async () => {
		widgetFile('deploy', DEPLOY);
		const seen: Array<[string, boolean]> = [];
		context.events.subscribe('widgets:reading-changed', ({ widgetId, reading }) =>
			seen.push([widgetId, reading]),
		);
		let release = (): void => undefined;
		gh.mockImplementationOnce(async (args) => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return ghAnswer(args);
		});
		const first = refresh('deploy');
		await vi.waitFor(() => expect(gh).toHaveBeenCalledTimes(1));
		const second = refresh('deploy');
		setTimeout(() => release(), 200);
		const [left, right] = await Promise.all([first, second]);
		expect(left).toEqual(right);
		expect(gh).toHaveBeenCalledTimes(1);
		expect(seen).toEqual([
			['deploy', true],
			['deploy', false],
		]);
	});
});

describe('saving a widget', () => {
	it('writes the file with your login, keeps ids unique, and reads a GitHub source once', async () => {
		const input = {
			title: 'Deploy runs',
			source: { github: 'repos/{owner}/{repo}/actions/runs', select: '{value: 1}' },
			refresh: { every: 120, on: ['pull-requests:ship-changed'] },
			sample: { value: 1 },
		};
		const changed = vi.fn();
		context.events.subscribe('widgets:board-changed', changed);

		const saved = await widgets.save(WORKSTREAM, input);
		expect(saved.path).toBe('.malini/widgets/deploy-runs.json');
		expect(saved.widget).toMatchObject({ id: 'deploy-runs', author: 'szymeo' });
		expect(saved.reading?.data).toMatchObject({ value: 7 });
		expect(changed).toHaveBeenCalledWith({ board: 'bestboyhq/malini' });
		expect(readFileSync(join(checkout, saved.path), 'utf8')).toBe(
			`${JSON.stringify(
				{
					title: 'Deploy runs',
					scope: 'shared',
					source: { github: 'repos/{owner}/{repo}/actions/runs', select: '{value: 1}' },
					refresh: { every: 120, on: ['pull-requests:ship-changed'] },
					size: 'small',
					author: 'szymeo',
				},
				null,
				'\t',
			)}\n`,
		);

		expect((await widgets.save(WORKSTREAM, input)).widget.id).toBe('deploy-runs-2');
		const overwritten = await widgets.save(WORKSTREAM, {
			...input,
			id: 'deploy-runs',
			size: 'large',
		});
		expect(overwritten.widget).toMatchObject({ id: 'deploy-runs', size: 'large' });
		expect((await widgets.save(WORKSTREAM, { ...input, title: 'Plan' })).widget.id).toBe('plan-2');

		const command = await widgets.save(WORKSTREAM, {
			title: 'Rooms',
			source: { command: 'echo ran >> runs.log' },
		});
		expect(command.reading).toBeNull();
		expect(runs()).toBe(0);
		expect((await board()).widgets.map(({ id }) => id)).toEqual([
			'plan',
			'deploy-runs',
			'deploy-runs-2',
			'plan-2',
			'rooms',
		]);
	});

	it('refuses a bad id, a missing title and a channel Malini does not emit', async () => {
		const source = { command: 'true' };
		await expect(widgets.save(WORKSTREAM, { id: 'Bad', title: 'Bad', source })).rejects.toThrow(
			'kebab-case',
		);
		await expect(widgets.save(WORKSTREAM, { id: 'plan', title: 'Mine', source })).rejects.toThrow(
			'built-in',
		);
		await expect(widgets.save(WORKSTREAM, { source })).rejects.toThrow('title');
		await expect(
			widgets.save(WORKSTREAM, { title: 'Rooms', source, refresh: { on: ['deploys:done'] } }),
		).rejects.toThrow('deploys:done');
		expect((await board()).widgets.map(({ id }) => id)).toEqual(['plan']);
	});
});

describe('watching', () => {
	it('reads while watched, on its events and file changes, and stops when unwatched', async () => {
		widgetFile('deploy', DEPLOY);
		widgetFile('suggested', { title: 'Suggested', source: { github: 'user' } });
		await place('deploy');
		const changed = vi.fn();
		context.events.subscribe('widgets:board-changed', changed);
		const paths = () => gh.mock.calls.map(([args]) => args[3]);

		await context.commands.call('widgets.watch', { workstreamId: WORKSTREAM, watching: true });
		await vi.waitFor(() => expect(paths().sort()).toEqual([DEPLOY.source.github, 'user']));

		context.events.emit('repositories:changed', {});
		await vi.waitFor(() => expect(paths()).toHaveLength(3));

		widgetFile('later', { title: 'Later', source: { github: 'later' } });
		context.events.emit('repositories:workstream-files-changed', {
			workstreamId: WORKSTREAM,
			changedAt: NOW,
			paths: ['.malini/widgets/later.json'],
		});
		await vi.waitFor(() => expect(changed).toHaveBeenCalledWith({ board: 'bestboyhq/malini' }));
		await vi.waitFor(() => expect(paths()).toContain('later'));

		await context.commands.call('widgets.watch', { workstreamId: WORKSTREAM, watching: false });
		const before = gh.mock.calls.length;
		context.events.emit('repositories:changed', {});
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(gh.mock.calls.length).toBe(before);
	});

	it('answers a workstream that is gone as expected, and watches it without a log line', async () => {
		const gone = { workstreamId: 'ws-gone' };
		await expect(context.commands.call('widgets.board', gone)).rejects.toMatchObject({
			kind: 'workstream-gone',
			verdict: 'expected',
		});
		await context.commands.call('widgets.watch', { ...gone, watching: true });
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(log).not.toHaveBeenCalled();
		await context.commands.call('widgets.watch', { ...gone, watching: false });
	});

	it('runs a changed command at once when you allow it, not at its next interval', async () => {
		const run = (value: number) => `echo ran >> runs.log; printf '{"value": ${value}}'`;
		widgetFile('rooms', { title: 'Rooms', source: { command: run(1) } });
		await place('rooms');
		await context.commands.call('widgets.watch', { workstreamId: WORKSTREAM, watching: true });
		await vi.waitFor(() => expect(runs()).toBe(1));

		widgetFile('rooms', { title: 'Rooms', source: { command: run(2) } });
		await place('rooms');
		await vi.waitFor(() => expect(runs()).toBe(2));
		const rooms = (await board()).readings.find(({ widgetId }) => widgetId === 'rooms');
		expect(rooms?.data).toMatchObject({ value: 2 });
		await context.commands.call('widgets.watch', { workstreamId: WORKSTREAM, watching: false });
	});

	it('reads a placed widget again once its interval passes, until the workstream is removed', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
		try {
			widgetFile('deploy', DEPLOY);
			await place('deploy');
			await context.commands.call('widgets.watch', { workstreamId: WORKSTREAM, watching: true });
			await vi.waitFor(() => expect(gh).toHaveBeenCalledTimes(1));
			await vi.advanceTimersByTimeAsync(15_000);
			await vi.waitFor(() => expect(gh).toHaveBeenCalledTimes(2));

			context.events.emit('repositories:workstream-removed', {
				workstreamId: WORKSTREAM,
				worktreePath: checkout,
				archived: true,
			});
			await vi.advanceTimersByTimeAsync(60_000);
			expect(gh).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});
});
