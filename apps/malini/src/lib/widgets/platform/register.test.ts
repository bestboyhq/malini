import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandName } from '$contract/commands';
import type { WidgetBoard } from '$contract/widgets';
import type { MainContext } from '$main/context';
import { openMigratedDatabase } from '$main/db/open';
import { canonicalJson } from '$main/db/rows';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import type { GhResult } from '$main/process/gh';
import { createNodeProcessRunner } from '$main/process/runner';
import {
	getProject,
	getWorkstream,
	upsertProject,
	upsertWorkstream,
} from '$shared/repositories/repositories.platform';
import { registerWidgets, type WidgetsPlatform } from './register';
import { mineHome, storeRoot } from './widget-store';
import { placeWidget } from './widgets.repository';

const NOW = '2026-11-22T00:00:00.000Z';
const WORKSTREAM = 'ws-1';
const BOARD = 'bestboyhq/malini';
const ORIGIN = 'https://github.com/bestboyhq/malini.git';
const SLOW = { timeout: 10_000 };

let context: MainContext;
let scratch: string;
let base: string;
let checkout: string;
let widgets: WidgetsPlatform;
let ghAnswer: (args: readonly string[]) => GhResult;
const gh = vi.fn(async (args: readonly string[], _options?: { cwd?: string; timeoutMs?: number }) =>
	ghAnswer(args),
);
const log = vi.fn((_line: string) => undefined);

beforeEach(() => {
	scratch = mkdtempSync(join(tmpdir(), 'malini-widgets-'));
	base = repository('base');
	checkout = repository('checkout');
	context = {
		db: openMigratedDatabase(':memory:'),
		commands: new CommandRegistry(),
		events: createEventBus({ forwardToWindows: false }),
		appDataRoot: join(scratch, 'app-data'),
		checkoutsRoot: scratch,
		resourcesRoot: scratch,
		isDev: false,
		appVersion: '0.0.0',
	};
	signedIn('szymeo');
	upsertProject(context.db, {
		id: 'project',
		name: 'malini',
		repoPath: base,
		defaultBranch: 'main',
		createdAt: NOW,
	});
	startWorkstream(WORKSTREAM, checkout);
	ghAnswer = () => ({ stdout: JSON.stringify({ value: 7, caption: 'runs' }), stderr: '', code: 0 });
	gh.mockClear();
	log.mockClear();
	widgets = register();
});

afterEach(() => {
	widgets.dispose();
	context.db.close();
	rmSync(scratch, { recursive: true, force: true });
});

function repository(name: string): string {
	const path = join(scratch, name);
	execFileSync('git', ['init', '-q', '-b', 'main', path]);
	git(path, 'remote', 'add', 'origin', ORIGIN);
	return path;
}

function git(path: string, ...args: string[]): void {
	execFileSync('git', ['-C', path, ...args]);
}

function signedIn(login: string | null): void {
	context.commands.define('repositories.github-auth-status', async () => ({
		authenticated: login !== null,
		installed: true,
		login,
		host: 'github.com',
		message: login === null ? 'Not signed in' : null,
	}));
}

function startWorkstream(id: string, path: string): void {
	upsertWorkstream(context.db, {
		id,
		projectId: 'project',
		name: id,
		path,
		branch: `malini/${id}`,
		baseBranch: 'main',
		status: 'active',
		createdAt: NOW,
		startedBy: null,
	});
}

function register(deps: Readonly<{ sharedCheckMs?: number }> = {}): WidgetsPlatform {
	return registerWidgets(context, {
		checkouts: { resolveCheckout: async (id) => getWorkstream(context.db, id)?.path ?? checkout },
		gh,
		runner: createNodeProcessRunner(),
		environment: () => ({ PATH: process.env['PATH'] ?? '/usr/bin:/bin', SHELL: '/bin/sh' }),
		secrets: { valuesReaching: () => ({ ROOMS_TOKEN: 'sekret' }) },
		log,
		eventDebounceMs: 10,
		...deps,
	});
}

function restart(login: string | null, deps: Readonly<{ sharedCheckMs?: number }> = {}): void {
	widgets.dispose();
	context = { ...context, commands: new CommandRegistry() };
	signedIn(login);
	widgets = register(deps);
}

function publish(files: Readonly<Record<string, unknown>>): void {
	const folder = join(base, '.malini', 'widgets');
	rmSync(folder, { recursive: true, force: true });
	mkdirSync(folder, { recursive: true });
	for (const [name, file] of Object.entries(files)) {
		writeFileSync(join(folder, name), typeof file === 'string' ? file : JSON.stringify(file));
	}
	git(base, 'add', '-A');
	git(
		base,
		'-c',
		'user.name=Test',
		'-c',
		'user.email=widgets',
		'-c',
		'commit.gpgsign=false',
		'commit',
		'-q',
		'--no-verify',
		'--allow-empty',
		'-m',
		'widgets',
	);
	git(base, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
}

function checkoutFile(name: string, text: string): void {
	mkdirSync(join(checkout, '.malini', 'widgets'), { recursive: true });
	writeFileSync(join(checkout, '.malini', 'widgets', name), text);
}

function home(id: string): string {
	return mineHome(storeRoot(context.appDataRoot, BOARD), id);
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

function place(widgetId: string, index = 0): Promise<WidgetBoard> {
	return context.commands.call('widgets.place', { workstreamId: WORKSTREAM, widgetId, index });
}

function remove(widgetId: string): Promise<WidgetBoard> {
	return context.commands.call('widgets.remove', { workstreamId: WORKSTREAM, widgetId });
}

function watch(watching: boolean): Promise<void> {
	return context.commands.call('widgets.watch', { workstreamId: WORKSTREAM, watching });
}

async function order(): Promise<Array<[string, string]>> {
	return (await board()).placements.map(({ widgetId, span }) => [
		widgetId,
		`${span.columns}x${span.rows}`,
	]);
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

const DEPLOY_SAVED = {
	...DEPLOY,
	id: 'deploy',
	refresh: { every: 5, on: ['repositories:changed'] },
};

const ROOMS = {
	title: 'Rooms',
	source: {
		command:
			'echo ran >> "$MALINI_CHECKOUT/runs.log"; printf \'{"value": %s, "caption": "%s", "unit": "%s"}\' "$(sh .malini/widgets/rooms.sh)" "$ROOMS_TOKEN" "$(basename "$PWD")"',
	},
};

describe('saving a widget', () => {
	it('keeps it in your own store, places it first, and reads it once', async () => {
		const input = {
			title: 'Deploy runs',
			source: { github: 'repos/{owner}/{repo}/actions/runs', select: '{value: 1}' },
			refresh: { every: 120, on: ['pull-requests:ship-changed'] },
		};
		const changed = vi.fn();
		context.events.subscribe('widgets:board-changed', changed);

		const saved = await widgets.save(WORKSTREAM, input);
		expect(saved.widget).toMatchObject({ id: 'deploy-runs', author: 'szymeo', origin: 'mine' });
		expect(saved.reading.data).toMatchObject({ value: 7 });
		expect(changed).toHaveBeenCalledWith({ board: BOARD });
		expect(
			readFileSync(join(home('deploy-runs'), '.malini/widgets/deploy-runs.json'), 'utf8'),
		).toBe(
			`${JSON.stringify(
				{
					title: 'Deploy runs',
					scope: 'shared',
					source: { github: 'repos/{owner}/{repo}/actions/runs', select: '{value: 1}' },
					refresh: { every: 120, on: ['pull-requests:ship-changed'] },
					author: 'szymeo',
				},
				null,
				'\t',
			)}\n`,
		);
		expect(existsSync(join(checkout, '.malini'))).toBe(false);

		expect((await widgets.save(WORKSTREAM, input)).widget.id).toBe('deploy-runs-2');
		await widgets.save(WORKSTREAM, { ...input, id: 'deploy-runs', title: 'Deploys' });
		expect((await widgets.save(WORKSTREAM, { ...input, title: 'Plan' })).widget.id).toBe('plan-2');
		expect(await order()).toEqual([
			['plan-2', '2x1'],
			['deploy-runs-2', '2x1'],
			['deploy-runs', '2x1'],
			['plan', '12x2'],
		]);
		expect((await board()).widgets.find(({ id }) => id === 'deploy-runs')?.title).toBe('Deploys');
	});

	it('runs a command in its own folder with its helper files, your checkout and your secrets', async () => {
		checkoutFile('rooms.sh', 'printf 4');
		const saved = await widgets.save(WORKSTREAM, ROOMS);
		expect(saved.reading.data).toMatchObject({ value: 4, caption: 'sekret', unit: 'rooms' });
		expect(runs()).toBe(1);

		checkoutFile('rooms.sh', 'printf 5');
		expect((await widgets.save(WORKSTREAM, { ...ROOMS, id: 'rooms' })).reading.data).toMatchObject({
			value: 5,
		});
		expect(readFileSync(join(home('rooms'), '.malini/widgets/rooms.sh'), 'utf8')).toBe('printf 5');
	});

	it('stops a command that prints too much', async () => {
		const flood = await widgets.save(WORKSTREAM, {
			title: 'Flood',
			source: { command: 'yes | head -c 300000' },
		});
		expect(flood.reading.error).toBe('The command printed more than 256 KB.');
	});

	it('refuses a bad id, a missing title, an unknown channel and an id shared from the default branch', async () => {
		publish({ 'deploy.json': DEPLOY });
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
		).rejects.toMatchObject({ message: expect.stringContaining('deploys:done') });
		await expect(
			widgets.save(WORKSTREAM, { id: 'deploy', title: 'Deploy', source }),
		).rejects.toMatchObject({ kind: 'shared-widget' });
		expect((await board()).widgets.map(({ id, origin }) => [id, origin])).toEqual([
			['plan', 'plan'],
			['deploy', 'shared'],
		]);
		expect(runs()).toBe(0);
	});
});

describe('the board', () => {
	it('reads shared widgets from the default branch strictly and skips each broken one once', async () => {
		publish({
			'deploy.json': DEPLOY,
			'rooms.json': { title: 'Rooms', scope: 'own', source: { command: 'node rooms.mjs' } },
			'broken.json': '{ not json',
			'Bad_Name.json': { title: 'Bad', source: { command: 'true' } },
			'escape.json': { title: 'Escape', source: { github: 'repos/../../user' } },
			'elsewhere.json': { title: 'Elsewhere', source: { github: 'https://evil.dev/x' } },
			'ftp.json': { title: 'Ftp', source: { command: 'true' }, url: 'ftp://x.dev' },
			'both.json': { title: 'Both', source: { command: 'true', github: 'user' } },
		});

		const first = await board();
		await board();

		expect(first.board).toBe(BOARD);
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
			url: 'https://github.com/bestboyhq/malini/actions',
			author: 'aleksander',
			fingerprint: createHash('sha256').update(canonicalJson(source)).digest('hex'),
			origin: 'shared',
		});
		expect(first.widgets[2]).toMatchObject({
			scope: 'own',
			source: { kind: 'command', run: 'node rooms.mjs' },
			refresh: { everySeconds: 300, on: [] },
			origin: 'shared',
		});
		expect(first.placements).toEqual([{ widgetId: 'plan', span: { columns: 12, rows: 2 } }]);
		expect(log).toHaveBeenCalledTimes(6);
	});

	it('starts a board once with the plan placed large, and keeps it off once removed', async () => {
		expect(await order()).toEqual([['plan', '12x2']]);
		await remove('plan');
		expect(await order()).toEqual([]);
		expect((await board()).widgets.map(({ id }) => id)).toEqual(['plan']);
	});

	it('pins the plan before the other widgets of a repository board, once', async () => {
		const pin = (repositoryFullName: string) =>
			context.commands.call('widgets.pin-plan', { repositoryFullName });
		publish({ 'deploy.json': DEPLOY });
		await remove('plan');
		await place('deploy');
		await pin(BOARD);
		expect(await order()).toEqual([
			['plan', '12x2'],
			['deploy', '2x1'],
		]);
		await place('plan', 1);
		await pin(BOARD);
		expect(await order()).toEqual([
			['deploy', '2x1'],
			['plan', '12x2'],
		]);
		await expect(
			call('widgets.pin-plan', { repositoryFullName: 'not a repository' }),
		).resolves.toMatchObject({ ok: false, error: expect.stringContaining('repositoryFullName') });
	});

	it('places, moves and resizes widgets, and refuses bad arguments', async () => {
		publish({ 'deploy.json': DEPLOY });
		checkoutFile('rooms.sh', 'printf 1');
		await widgets.save(WORKSTREAM, ROOMS);
		await place('deploy', 0);
		expect(await order()).toEqual([
			['deploy', '2x1'],
			['rooms', '2x1'],
			['plan', '12x2'],
		]);
		await place('deploy', 2);
		expect(await order()).toEqual([
			['rooms', '2x1'],
			['plan', '12x2'],
			['deploy', '2x1'],
		]);
		const resized = await context.commands.call('widgets.resize', {
			workstreamId: WORKSTREAM,
			widgetId: 'rooms',
			span: { columns: 3, rows: 4 },
		});
		expect(resized.placements[0]).toEqual({ widgetId: 'rooms', span: { columns: 3, rows: 4 } });
		expect((await place('rooms', 1)).placements[1]).toEqual({
			widgetId: 'rooms',
			span: { columns: 3, rows: 4 },
		});

		const refused = (field: string) => ({ ok: false, error: expect.stringContaining(field) });
		const workstreamId = WORKSTREAM;
		await expect(
			call('widgets.place', { workstreamId, widgetId: 'Nope', index: 0 }),
		).resolves.toMatchObject(refused('widgetId'));
		for (const index of [-1, 1.5, null, '0']) {
			await expect(
				call('widgets.place', { workstreamId, widgetId: 'deploy', index }),
			).resolves.toMatchObject(refused('index'));
		}
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
			call('widgets.resize', { workstreamId, widgetId: 'gone', span: { columns: 1, rows: 1 } }),
		).resolves.toMatchObject(refused('No widget `gone`'));
		await expect(
			call('widgets.place', { workstreamId, widgetId: 'gone', index: 0 }),
		).resolves.toMatchObject(refused('No widget `gone`'));
		await expect(
			call('widgets.share', { workstreamId, widgetId: 'rooms', into: '' }),
		).resolves.toMatchObject(refused('into'));
		await expect(call('widgets.watch', { workstreamId, watching: 'yes' })).resolves.toMatchObject(
			refused('watching'),
		);
		await expect(call('widgets.board', { workstreamId: '' })).resolves.toMatchObject(
			refused('workstreamId'),
		);
	});

	it('takes a shared widget off the board, and deletes your own with its reading', async () => {
		publish({ 'deploy.json': DEPLOY });
		checkoutFile('rooms.sh', 'printf 1');
		await widgets.save(WORKSTREAM, ROOMS);
		await place('deploy');

		const shared = await remove('deploy');
		expect(shared.placements.map(({ widgetId }) => widgetId)).toEqual(['rooms', 'plan']);
		expect(shared.widgets.map(({ id }) => id)).toEqual(['plan', 'deploy', 'rooms']);

		const mine = await remove('rooms');
		expect(mine.placements.map(({ widgetId }) => widgetId)).toEqual(['plan']);
		expect(mine.widgets.map(({ id }) => id)).toEqual(['plan', 'deploy']);
		expect(mine.readings.map(({ widgetId }) => widgetId)).toEqual([]);
		expect(existsSync(home('rooms'))).toBe(false);
	});

	it('keeps a placed widget whose file an older Malini wrote into the checkout', async () => {
		await board();
		checkoutFile('rooms.json', JSON.stringify({ title: 'Rooms', source: { command: 'true' } }));
		checkoutFile('loose.json', JSON.stringify({ title: 'Loose', source: { command: 'true' } }));
		placeWidget(context.db, BOARD, {
			widgetId: 'rooms',
			before: null,
			span: { columns: 1, rows: 1 },
		});

		const adopted = await board();
		expect(adopted.widgets.map(({ id, origin }) => [id, origin])).toEqual([
			['plan', 'plan'],
			['rooms', 'mine'],
		]);
		expect(adopted.placements.map(({ widgetId }) => widgetId)).toEqual(['plan', 'rooms']);
		expect(existsSync(join(home('rooms'), '.malini/widgets/rooms.json'))).toBe(true);
	});

	it('updates a shared widget for everyone once the default branch changes', async () => {
		restart('szymeo', { sharedCheckMs: 20 });
		publish({ 'deploy.json': DEPLOY });
		checkoutFile('rooms.sh', 'printf 1');
		await widgets.save(WORKSTREAM, ROOMS);
		await place('deploy');
		const changed = vi.fn();
		context.events.subscribe('widgets:board-changed', changed);
		await watch(true);
		await vi.waitFor(() => expect(gh).toHaveBeenCalledTimes(1), SLOW);

		const rooms = { ...ROOMS, title: 'Rooms on main' };
		publish({
			'deploy.json': {
				...DEPLOY,
				title: 'Deploys',
				source: { ...DEPLOY.source, select: '{value: 2}' },
			},
			'rooms.json': rooms,
			'rooms.sh': 'printf 9',
		});
		await vi.waitFor(() => expect(changed).toHaveBeenCalledWith({ board: BOARD }), SLOW);
		await vi.waitFor(() => expect(gh).toHaveBeenCalledTimes(2), SLOW);
		expect(gh.mock.lastCall?.[0]).toContain('{value: 2}');

		const updated = await board();
		expect(updated.widgets.map(({ id, title, origin }) => [id, title, origin])).toEqual([
			['plan', 'Plan', 'plan'],
			['deploy', 'Deploys', 'shared'],
			['rooms', 'Rooms on main', 'shared'],
		]);
		expect(updated.placements.map(({ widgetId }) => widgetId)).toEqual(['deploy', 'rooms', 'plan']);
		await vi.waitFor(
			async () =>
				expect(
					(await board()).readings.find(({ widgetId }) => widgetId === 'rooms')?.data,
				).toMatchObject({ value: 9 }),
			SLOW,
		);
		await expect(
			context.commands.call('widgets.share', {
				workstreamId: WORKSTREAM,
				widgetId: 'rooms',
				into: WORKSTREAM,
			}),
		).rejects.toMatchObject({ kind: 'shared-widget' });
		await watch(false);
	});
});

describe('making a widget a default', () => {
	it('copies your widget and its helpers into the new workstream once it starts', async () => {
		checkoutFile('rooms.sh', 'printf 1');
		await widgets.save(WORKSTREAM, ROOMS);
		const second = repository('second');

		const shared = context.commands.call('widgets.share', {
			workstreamId: WORKSTREAM,
			widgetId: 'rooms',
			into: 'ws-2',
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(existsSync(join(second, '.malini'))).toBe(false);
		startWorkstream('ws-2', second);
		const project = getProject(context.db, 'project');
		const workstream = getWorkstream(context.db, 'ws-2');
		if (project === null || workstream === null) throw new Error('the workstream was not stored');
		context.events.emit('repositories:workstream-created', {
			workstreamId: 'ws-2',
			project,
			workstream,
		});
		await shared;

		expect(readFileSync(join(second, '.malini/widgets/rooms.sh'), 'utf8')).toBe('printf 1');
		expect(
			JSON.parse(readFileSync(join(second, '.malini/widgets/rooms.json'), 'utf8')),
		).toMatchObject({
			title: 'Rooms',
			author: 'szymeo',
		});
	});
});

describe('readings', () => {
	it('keeps the last good data through a failed read and a restart', async () => {
		const deploy = DEPLOY_SAVED;
		const good = (await widgets.save(WORKSTREAM, deploy)).reading;
		expect(good).toMatchObject({ data: { value: 7 }, error: null, reading: false });

		ghAnswer = () => ({ stdout: '', stderr: 'gh: Server Error (HTTP 502)\n', code: 1 });
		const failed = (await widgets.save(WORKSTREAM, deploy)).reading;
		expect(failed).toMatchObject({ data: { value: 7 }, error: 'gh: Server Error (HTTP 502)' });
		expect(failed.readAt).toBe(good.readAt);

		ghAnswer = () => ({ stdout: 'null', stderr: '', code: 0 });
		expect((await widgets.save(WORKSTREAM, deploy)).reading).toMatchObject({
			data: { value: 7 },
			error: 'The source printed JSON, but not an object.',
		});

		restart(null);
		const restarted = await board();
		expect(restarted.me).toBeNull();
		expect(restarted.readings).toEqual([
			expect.objectContaining({ widgetId: 'deploy', data: expect.objectContaining({ value: 7 }) }),
		]);
	});

	it('reads one widget once at a time and tells the board when a read starts and ends', async () => {
		const deploy = DEPLOY_SAVED;
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
		const first = widgets.save(WORKSTREAM, deploy);
		await vi.waitFor(() => expect(gh).toHaveBeenCalledTimes(1));
		const second = widgets.save(WORKSTREAM, deploy);
		setTimeout(() => release(), 200);
		const [left, right] = await Promise.all([first, second]);
		expect(left.reading).toEqual(right.reading);
		expect(gh).toHaveBeenCalledTimes(1);
		expect(seen).toEqual([
			['deploy', true],
			['deploy', false],
		]);
	});
});

describe('watching', () => {
	it('reads only placed widgets while watched, on their events, and stops when unwatched', async () => {
		publish({
			'deploy.json': DEPLOY,
			'suggested.json': { title: 'Suggested', source: { github: 'user' } },
		});
		await place('deploy');
		const paths = () => gh.mock.calls.map(([args]) => args[3]);

		await watch(true);
		await vi.waitFor(() => expect(paths()).toEqual([DEPLOY.source.github]));

		context.events.emit('repositories:changed', {});
		await vi.waitFor(() => expect(paths()).toEqual([DEPLOY.source.github, DEPLOY.source.github]));

		await watch(false);
		context.events.emit('repositories:changed', {});
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(paths()).toHaveLength(2);
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

	it('reads a placed widget again once its interval passes, until the workstream is removed', async () => {
		publish({ 'deploy.json': DEPLOY });
		await place('deploy');
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
		try {
			await watch(true);
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
