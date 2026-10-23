import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));

import {
	APP_CLOSE_REQUESTED_CHANNEL,
	APP_MENU_COMMAND_CHOSEN_CHANNEL,
	APP_NOTIFICATION_OPENED_CHANNEL,
	APP_SCALE_CHANGED_CHANNEL,
} from '$contract/events';
import { createEventBus } from '$main/events';
import { createFakeHost, createFakeWindow, asBrowserWindow, type FakeWindow } from './test-support';
import {
	NOTIFICATIONS_UNSUPPORTED_ERROR,
	NO_MAIN_WINDOW_ERROR,
	WINDOW_STATE_FILE,
	createWindowCommands,
	isValidWindowState,
	readMainWindowState,
	saveMainWindowState,
	showsOnADisplay,
	type WindowCommands,
} from './window';

let root: string;
const windowCommands: WindowCommands[] = [];

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'malini-window-'));
});

afterEach(async () => {
	await Promise.all(windowCommands.splice(0).map((commands) => commands.windowStateSaved()));
	await rm(root, { recursive: true, force: true });
});

function setup(main: FakeWindow | null = createFakeWindow()) {
	const host = createFakeHost();
	const events = createEventBus({ forwardToWindows: false });
	const received: string[] = [];
	events.subscribe(APP_CLOSE_REQUESTED_CHANNEL, () => received.push('close-requested'));
	events.subscribe(APP_SCALE_CHANGED_CHANNEL, () => received.push('scale-changed'));
	let current = main;
	const commands = createWindowCommands({
		getMainWindow: () => current?.window ?? null,
		host,
		events,
		appDataRoot: root,
	});
	windowCommands.push(commands);
	return {
		host,
		commands,
		events,
		received,
		main,
		setMain(next: FakeWindow | null) {
			current = next;
		},
		created(window: FakeWindow) {
			for (const listener of host.windowCreated) listener(asBrowserWindow(window.window));
		},
	};
}

describe('window commands', () => {
	it('focus shows, unminimizes and focuses the main window, and opens one without it', () => {
		const { commands, main, host } = setup();
		if (!main) throw new Error('unreachable');
		main.minimized = true;
		commands.focusMainWindow();
		expect(main.calls).toEqual(['show', 'restore', 'focus']);
		expect(host.openedWindows).toBe(0);

		const empty = setup(null);
		empty.commands.focusMainWindow();
		expect(empty.host.openedWindows).toBe(1);
	});

	it('sets the interface scale on the web contents and announces the change', () => {
		const { commands, main, received } = setup();
		commands.setInterfaceScale({ scale: 1.25 });
		expect(main?.zoom).toBe(1.25);
		expect(received).toEqual(['scale-changed']);
		expect(() => commands.setInterfaceScale({ scale: 0 })).toThrow('positive number');
		expect(() => commands.setInterfaceScale({ scale: Number.NaN })).toThrow('positive number');
		const empty = setup(null);
		expect(() => empty.commands.setInterfaceScale({ scale: 1 })).toThrow(NO_MAIN_WINDOW_ERROR);
	});

	it('reports the logical viewport from the content size', () => {
		const { commands } = setup();
		expect(commands.logicalViewport()).toEqual({ width: 1280, height: 800 });
		expect(() => setup(null).commands.logicalViewport()).toThrow(NO_MAIN_WINDOW_ERROR);
	});

	it('display metric changes are announced as a scale change', () => {
		const { host, received } = setup();
		for (const listener of host.displayMetricsChanged) listener();
		expect(received).toEqual(['scale-changed']);
	});
});

describe('close guard', () => {
	it('lets a close through until the renderer arms the guard', () => {
		const { commands, main, received, created } = setup();
		if (!main) throw new Error('unreachable');
		created(main);
		expect(main.emit('close').defaultPrevented).toBe(false);
		expect(received).toEqual([]);

		commands.setCloseGuard({ armed: true });
		expect(commands.closeGuardArmed).toBe(true);
		expect(main.emit('close').defaultPrevented).toBe(true);
		expect(received).toEqual(['close-requested']);

		commands.setCloseGuard({ armed: false });
		expect(main.emit('close').defaultPrevented).toBe(false);
	});

	it('attaches on arm when the window was created before the shell saw it', () => {
		const { commands, main, received } = setup();
		if (!main) throw new Error('unreachable');
		commands.setCloseGuard({ armed: true });
		expect(main.emit('close').defaultPrevented).toBe(true);
		expect(received).toEqual(['close-requested']);
	});

	it('never holds a quit, and only guards the main window', () => {
		const { host, commands, main, created } = setup();
		if (!main) throw new Error('unreachable');
		created(main);
		commands.setCloseGuard({ armed: true });

		const other = createFakeWindow();
		created(other);
		expect(other.emit('close').defaultPrevented).toBe(false);

		for (const listener of host.beforeQuit) listener();
		expect(main.emit('close').defaultPrevented).toBe(false);
	});

	it('destroy closes past the guard and disarms it', () => {
		const { commands, main, created } = setup();
		if (!main) throw new Error('unreachable');
		created(main);
		commands.setCloseGuard({ armed: true });
		commands.destroy();
		expect(main.calls).toContain('destroy');
		expect(main.destroyed).toBe(true);
		expect(commands.closeGuardArmed).toBe(false);
		expect(() => commands.destroy()).not.toThrow();
	});

	it('disarms when the renderer is gone or navigates, so the window can always close', () => {
		const { commands, main, created } = setup();
		if (!main) throw new Error('unreachable');
		created(main);
		commands.setCloseGuard({ armed: true });
		main.emitWebContents('render-process-gone');
		expect(commands.closeGuardArmed).toBe(false);
		commands.setCloseGuard({ armed: true });
		main.emitWebContents('did-navigate');
		expect(commands.closeGuardArmed).toBe(false);
		expect(main.emit('close').defaultPrevented).toBe(false);
	});

	it('reloads a crashed renderer once per cooldown and leaves a clean exit alone', () => {
		const { main, created } = setup();
		if (!main) throw new Error('unreachable');
		created(main);
		main.emitWebContents('render-process-gone', {}, { reason: 'clean-exit' });
		main.emitWebContents('render-process-gone', {}, { reason: 'oom' });
		main.emitWebContents('render-process-gone', {}, { reason: 'oom' });
		expect(main.calls.filter((call) => call === 'reload')).toEqual(['reload']);
	});

	it('never reloads a renderer that goes away while the app quits', () => {
		const { host, main, created } = setup();
		if (!main) throw new Error('unreachable');
		created(main);
		for (const listener of host.beforeQuit) listener();
		main.emitWebContents('render-process-gone', {}, { reason: 'killed' });
		expect(main.calls).not.toContain('reload');
	});

	it('rejects a non-boolean arm flag', () => {
		const { commands } = setup();
		expect(() => commands.setCloseGuard(Object.assign({ armed: true }, { armed: 'yes' }))).toThrow(
			'armed must be a boolean',
		);
	});
});

describe('notifications', () => {
	it('shows a notification through the host and reports support as permission', () => {
		const { host, commands } = setup();
		commands.notify({ options: { title: 'Run finished', body: 'ws-1' } });
		expect(host.notifications).toEqual([{ title: 'Run finished', body: 'ws-1' }]);
		expect(commands.isNotificationPermissionGranted()).toBe(true);
		expect(commands.requestNotificationPermission()).toBe('granted');

		host.notificationsAvailable = false;
		expect(() => commands.notify({ options: { title: 'x', body: 'y' } })).toThrow(
			NOTIFICATIONS_UNSUPPORTED_ERROR,
		);
		expect(commands.isNotificationPermissionGranted()).toBe(false);
		expect(commands.requestNotificationPermission()).toBe('denied');
		expect(() =>
			commands.notify(
				Object.assign({ options: { title: '', body: '' } }, { options: { title: 'x' } }),
			),
		).toThrow('title and a body');
	});
});

describe('a notification that opens a chat', () => {
	it('brings the window forward and announces the chat once it is clicked', () => {
		const { host, commands, events, main } = setup();
		const opened: unknown[] = [];
		events.subscribe(APP_NOTIFICATION_OPENED_CHANNEL, (payload) => opened.push(payload));

		commands.notify({
			options: {
				title: 'Agent needs your input',
				body: 'Lunar Relay',
				opens: { workstreamId: 'ws-1', sessionId: 'chat-1' },
			},
		});
		expect(opened).toEqual([]);

		host.notifications[0]?.onClick?.();

		expect(opened).toEqual([{ workstreamId: 'ws-1', sessionId: 'chat-1' }]);
		expect(main?.calls).toEqual(expect.arrayContaining(['show', 'focus']));
	});

	it('keeps the chat a notification opened for the next window when none was open', () => {
		const { host, commands, setMain } = setup();
		commands.notify({
			options: {
				title: 'Agent needs your input',
				body: 'Lunar Relay',
				opens: { workstreamId: 'ws-1', sessionId: 'chat-1' },
			},
		});
		setMain(null);

		host.notifications[0]?.onClick?.();

		expect(commands.takeNotificationTarget()).toEqual({
			workstreamId: 'ws-1',
			sessionId: 'chat-1',
		});
		expect(commands.takeNotificationTarget()).toBeNull();
	});

	it('opens the window it points to when none was open', () => {
		const { host, commands, setMain } = setup();
		commands.notify({
			options: {
				title: 'Agent needs your input',
				body: 'Lunar Relay',
				opens: { workstreamId: 'ws-1', sessionId: 'chat-1' },
			},
		});
		setMain(null);

		host.notifications[0]?.onClick?.();

		expect(host.openedWindows).toBe(1);
	});

	it('refuses a chat target without its ids', () => {
		const { commands } = setup();
		expect(() =>
			commands.notify(
				Object.assign(
					{ options: { title: 'x', body: 'y' } },
					{ options: { title: 'x', body: 'y', opens: { workstreamId: 'ws-1' } } },
				),
			),
		).toThrow('opens a workstream chat by its ids');
	});
});

describe('main window state', () => {
	it('round-trips outer bounds and zoom, and rejects a zero size or zoom', async () => {
		const state = { x: 2048, y: 96, width: 1440, height: 960, zoomFactor: 0.8 };
		await saveMainWindowState(root, state);
		expect(await readMainWindowState(root)).toEqual(state);
		expect(isValidWindowState(state)).toBe(true);
		expect(isValidWindowState({ x: 0, y: 0, width: 800, height: 800 })).toBe(true);
		expect(isValidWindowState({ x: 0, y: 0, width: 0, height: 800 })).toBe(false);
		expect(isValidWindowState({ x: 0, y: 0, width: 1.5, height: 800 })).toBe(false);
		expect(isValidWindowState({ x: 0, y: 0, width: 800, height: 800, zoomFactor: 0 })).toBe(false);
		expect(isValidWindowState(null)).toBe(false);
	});

	it('ignores an unreadable or invalid file', async () => {
		expect(await readMainWindowState(root)).toBeNull();
		await writeFile(join(root, WINDOW_STATE_FILE), '{not json');
		expect(await readMainWindowState(root)).toBeNull();
		await writeFile(join(root, WINDOW_STATE_FILE), JSON.stringify({ width: 0, height: 1 }));
		expect(await readMainWindowState(root)).toBeNull();
	});

	it('restores saved bounds and zoom on the created window and saves on move and close', async () => {
		await saveMainWindowState(root, { x: 5, y: 6, width: 700, height: 500, zoomFactor: 0.8 });
		const { main, created } = setup();
		if (!main) throw new Error('unreachable');
		created(main);
		await vi.waitFor(() => expect(main.calls).toContain('setBounds'));
		expect(main.bounds).toEqual({ x: 5, y: 6, width: 700, height: 500 });
		expect(main.zoom).toBe(0.8);

		main.bounds = { x: 50, y: 60, width: 1000, height: 640 };
		main.emit('move');
		await vi.waitFor(async () =>
			expect(JSON.parse(await readFile(join(root, WINDOW_STATE_FILE), 'utf8'))).toEqual({
				...main.bounds,
				zoomFactor: 0.8,
			}),
		);

		main.bounds = { x: 1, y: 2, width: 900, height: 600 };
		main.zoom = 0.9;
		main.emit('close');
		await vi.waitFor(async () =>
			expect(JSON.parse(await readFile(join(root, WINDOW_STATE_FILE), 'utf8'))).toEqual({
				...main.bounds,
				zoomFactor: 0.9,
			}),
		);
	});

	it('keeps the zoom across route changes and restores it on the next launch', async () => {
		await saveMainWindowState(root, { x: 5, y: 6, width: 700, height: 500, zoomFactor: 1.25 });
		const { main, created } = setup();
		if (!main) throw new Error('unreachable');
		created(main);
		await vi.waitFor(() => expect(main.zoom).toBe(1.25));

		main.zoom = 1.5;
		main.emitWebContents('did-start-navigation');
		main.zoom = 1;
		main.emitWebContents('did-navigate-in-page');
		expect(main.zoom).toBe(1.5);

		expect(isValidWindowState({ x: 0, y: 0, width: 9, height: 9, zoomFactor: 0 })).toBe(false);
	});

	it('opens where it was only while that place is on a connected display', async () => {
		await saveMainWindowState(root, {
			x: 3675,
			y: 2246,
			width: 1280,
			height: 800,
			zoomFactor: 1.2,
		});
		const offScreen = setup();
		if (!offScreen.main) throw new Error('unreachable');
		offScreen.created(offScreen.main);
		await vi.waitFor(() => expect(offScreen.main?.zoom).toBe(1.2));
		expect(offScreen.main.calls).not.toContain('setBounds');

		const workAreas = [
			{ x: 0, y: 0, width: 2056, height: 1290 },
			{ x: 2056, y: 0, width: 2560, height: 1440 },
		];
		expect(showsOnADisplay({ x: 3675, y: 400, width: 1280, height: 800 }, workAreas)).toBe(true);
		expect(showsOnADisplay({ x: 4615, y: 0, width: 1280, height: 800 }, workAreas)).toBe(false);
		expect(showsOnADisplay({ x: -1270, y: 0, width: 1280, height: 800 }, workAreas)).toBe(false);
	});

	it('saves the last bounds of a resize burst, one write at a time', async () => {
		const { main, created, commands } = setup();
		if (!main) throw new Error('unreachable');
		created(main);
		for (let width = 1_000; width >= 900; width -= 1) {
			main.bounds = { x: 0, y: 0, width, height: width - 300 };
			main.emit('resize');
		}

		await commands.windowStateSaved();

		expect(await readMainWindowState(root)).toEqual({
			x: 0,
			y: 0,
			width: 900,
			height: 600,
			zoomFactor: 1,
		});
	});
});

describe('a menu command', () => {
	it('brings the window forward, announces the command and hands it over once', () => {
		const { commands, events, main } = setup();
		const chosen: unknown[] = [];
		events.subscribe(APP_MENU_COMMAND_CHOSEN_CHANNEL, (payload) => chosen.push(payload));

		commands.chooseMenuCommand('new-chat');

		expect(chosen).toEqual([{ command: 'new-chat' }]);
		expect(main?.calls).toEqual(expect.arrayContaining(['show', 'focus']));
		expect(commands.takeMenuCommand()).toEqual({ command: 'new-chat' });
		expect(commands.takeMenuCommand()).toBeNull();
	});

	it('opens a window and keeps the command for it when none was open', () => {
		const { host, commands } = setup(null);

		commands.chooseMenuCommand('open-folder');

		expect(host.openedWindows).toBe(1);
		expect(commands.takeMenuCommand()).toEqual({ command: 'open-folder' });
	});
});
