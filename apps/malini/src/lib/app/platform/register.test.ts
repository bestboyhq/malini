import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
	app: {},
	BrowserWindow: { getAllWindows: () => [] },
	clipboard: {},
	ipcMain: { handle: vi.fn() },
	Notification: {},
	safeStorage: {},
	screen: {},
	shell: {},
}));

import type { MainContext } from '$main/context';
import { MainDiagnosticsLog } from '$main/diagnostics/main-diagnostics';
import { DockerOwnership } from '$main/docker/ownership';
import { ScriptedRunner } from '$main/process/test-support';
import type { AppPlatform } from '../app.platform';
import { registerApp, type AppDeps } from './register';
import {
	asBrowserWindow,
	createFakeHost,
	createFakeWindow,
	createTestContext,
	type FakeHost,
} from './test-support';

const KEPT_COMMANDS = [
	'app.get-secret',
	'app.set-secret',
	'app.delete-secret',
	'app.open-external-url',
	'app.copy-text',
	'app.focus-window',
	'app.runtime-identity',
	'app.runtime-info',
	'app.report-renderer-error',
	'app.report-toast',
	'app.recent-diagnostics',
	'app.interface-scale',
	'app.logical-viewport',
	'app.close-guard',
	'app.destroy-window',
	'app.notify',
	'app.take-notification-target',
	'app.notification-permission-granted',
	'app.request-notification-permission',
	'app.list-settings',
	'app.set-setting',
	'app.shutdown-gracefully',
	'app.shutdown-impact',
];

const DROPPED_COMMANDS = [
	'check_backend_reachable',
	'update_check',
	'update_download_and_install',
	'update_relaunch',
	'github_request_device_code',
	'github_poll_device_token',
	'github_oauth_loopback_start',
	'github_oauth_loopback_stop',
];

let root: string;
let context: MainContext;
let host: FakeHost;
const booted: AppPlatform[] = [];

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'malini-shell-'));
	context = createTestContext(root);
	host = createFakeHost();
});

afterEach(async () => {
	await Promise.all(booted.splice(0).map((platform) => platform.windowStateSaved()));
	context.db.close();
	await rm(root, { recursive: true, force: true });
});

const invoke = (command: string, args: unknown = {}) => context.commands.invoke({ command, args });

function boot(target: MainContext, overrides: Partial<AppDeps> = {}): void {
	booted.push(
		registerApp(target, {
			getMainWindow: () => null,
			host,
			ownership: new DockerOwnership({
				db: target.db,
				runner: new ScriptedRunner(),
				appDataRoot: target.appDataRoot,
				bundleIdentifier: 'app.malini.desktop.dev',
			}),
			...overrides,
		}),
	);
}

describe('registerApp', () => {
	it('registers every kept command and none of the dropped ones', () => {
		boot(context);
		const names = context.commands.names();
		for (const command of KEPT_COMMANDS) expect(names).toContain(command);
		for (const command of DROPPED_COMMANDS) expect(names).not.toContain(command);
	});

	it('answers the typed runtime identity, fingerprinting the real executable once', async () => {
		const executable = join(root, 'malini-bin');
		await writeFile(executable, 'not really a binary');
		host.executablePath = executable;
		boot(context);

		const first = await invoke('app.runtime-identity');
		expect(first.ok).toBe(true);
		if (!first.ok) return;
		expect(first.value).toEqual({
			productName: 'malini',
			bundleIdentifier: 'app.malini.desktop.dev',
			version: '0.1.0',
			buildProfile: 'debug',
			pid: process.pid,
			executablePath: await realpath(executable),
			executableFingerprint: createHash('sha256').update('not really a binary').digest('hex'),
			appDataRoot: root,
		});
		expect(Object.keys(first.value as object).sort()).toEqual(
			[
				'appDataRoot',
				'buildProfile',
				'bundleIdentifier',
				'executableFingerprint',
				'executablePath',
				'pid',
				'productName',
				'version',
			].sort(),
		);
		await writeFile(executable, 'changed under a running process');
		expect(await invoke('app.runtime-identity')).toEqual(first);
	});

	it('a packaged build reports the release profile and the shipping identifier', async () => {
		const executable = join(root, 'malini-bin');
		await writeFile(executable, 'bin');
		host.executablePath = executable;
		const packaged = createTestContext(root, { isDev: false, appVersion: '1.2.3' });
		boot(packaged);
		const result = await packaged.commands.invoke({ command: 'app.runtime-identity', args: {} });
		expect(result).toMatchObject({
			ok: true,
			value: { bundleIdentifier: 'app.malini.desktop', buildProfile: 'release', version: '1.2.3' },
		});
		packaged.db.close();
	});

	it('opens http(s) urls through the host and refuses the rest', async () => {
		boot(context);
		expect(
			await invoke('app.open-external-url', { url: 'https://github.com/login/device' }),
		).toEqual({
			ok: true,
			value: null,
		});
		expect(host.opened).toEqual(['https://github.com/login/device']);
		expect(await invoke('app.open-external-url', { url: 'file:///etc/passwd' })).toEqual({
			ok: false,
			error: 'refusing to open a file: URL',
		});
		expect(await invoke('app.open-external-url', { url: 'nope' })).toEqual({
			ok: false,
			error: 'not a URL: nope',
		});
		expect(await invoke('app.open-external-url', {})).toMatchObject({ ok: false });
	});

	it('writes clipboard text through the host', async () => {
		boot(context);
		expect(await invoke('app.copy-text', { text: 'ABCD-1234' })).toEqual({
			ok: true,
			value: null,
		});
		expect(host.clipboard).toEqual(['ABCD-1234']);
		expect(await invoke('app.copy-text', { text: 7 })).toEqual({
			ok: false,
			error: 'text must be a string',
		});
	});

	it('round-trips secrets with the renderer argument keys', async () => {
		boot(context);
		const args = { service: 'malini.desktop.auth', key: 'session' };
		expect(await invoke('app.get-secret', args)).toEqual({ ok: true, value: null });
		expect(await invoke('app.set-secret', { ...args, value: 's3cret' })).toEqual({
			ok: true,
			value: null,
		});
		expect(await invoke('app.get-secret', args)).toEqual({ ok: true, value: 's3cret' });
		expect(await invoke('app.delete-secret', args)).toEqual({ ok: true, value: null });
		expect(await invoke('app.get-secret', args)).toEqual({ ok: true, value: null });
	});

	it('appends a renderer error from the `{ payload }` envelope and returns the receipt', async () => {
		boot(context);
		const result = await invoke('app.report-renderer-error', {
			payload: {
				schemaVersion: 1,
				occurredAt: '2026-07-18T14:00:00+02:00',
				source: 'caught',
				route: '/w/1?x=1',
				error: { name: 'TypeError', message: 'boom', stack: null },
			},
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const receipt = result.value as { path: string; sizeBytes: number; rotated: boolean };
		expect(receipt.path).toBe(join(root, 'diagnostics', 'renderer-errors.ndjson'));
		expect(receipt.rotated).toBe(false);
		const record = JSON.parse((await readFile(receipt.path, 'utf8')).trim());
		expect(record.runtime).toEqual({
			productName: 'malini',
			bundleIdentifier: 'app.malini.desktop.dev',
			version: '0.1.0',
			pid: process.pid,
		});
		expect(
			await invoke('app.report-renderer-error', {
				payload: {
					schemaVersion: 2,
					occurredAt: '2026-07-18T14:00:00+02:00',
					source: 'caught',
					route: '/',
					error: { name: 'E', message: 'm', stack: null },
				},
			}),
		).toEqual({ ok: false, error: 'unsupported renderer error schema version: 2' });
		expect(await invoke('app.report-renderer-error', { payload: null })).toEqual({
			ok: false,
			error: 'invalid renderer error payload: expected an object',
		});
	});

	it('records toasts and serves main and renderer diagnostics merged, newest first, telling the workstream a toast is about from the one on screen', async () => {
		boot(context);
		await invoke('app.report-renderer-error', {
			payload: {
				schemaVersion: 1,
				occurredAt: '2026-09-23T08:00:00.000Z',
				source: 'caught',
				route: '/workstreams/ws-9',
				error: { name: 'TypeError', message: 'x is undefined', stack: null },
			},
		});
		const mainLog = new MainDiagnosticsLog({
			appDataRoot: root,
			runtime: { productName: 'malini', bundleIdentifier: 'b', version: '0.1.0', pid: 1 },
			now: () => new Date('2026-09-23T08:00:01.000Z'),
		});
		mainLog.record({
			level: 'error',
			source: 'ipc-command',
			message: 'io error: EACCES: permission denied',
			command: 'repositories.archive-workstream',
			workstreamId: 'ws-9',
			durationMs: 31,
		});
		mainLog.record({
			level: 'info',
			source: 'console',
			message: 'agent: reaped 0 orphaned run(s) on startup',
		});
		const toast = await invoke('app.report-toast', {
			payload: {
				schemaVersion: 1,
				occurredAt: '2026-09-23T08:00:02.000Z',
				route: '/workstreams/ws-9?agent=chat-1',
				level: 'error',
				text: 'Could not archive Neon Circuit · It is in use, so nothing was removed.',
				workstreamId: 'ws-2',
			},
		});
		expect(toast).toMatchObject({ ok: true });

		const recent = await invoke('app.recent-diagnostics', { limit: 10 });

		expect(recent).toEqual({
			ok: true,
			value: [
				expect.objectContaining({
					process: 'renderer',
					level: 'error',
					source: 'toast',
					message: 'Could not archive Neon Circuit · It is in use, so nothing was removed.',
					workstreamId: 'ws-2',
					viewing: 'ws-9',
					route: '/workstreams/ws-9?agent=%5Bredacted%5D',
				}),
				expect.objectContaining({
					process: 'main',
					source: 'ipc-command',
					command: 'repositories.archive-workstream',
					durationMs: 31,
					workstreamId: 'ws-9',
					viewing: null,
				}),
				expect.objectContaining({
					process: 'renderer',
					source: 'caught',
					errorName: 'TypeError',
					message: 'x is undefined',
					workstreamId: null,
					viewing: 'ws-9',
				}),
			],
		});
		expect(await invoke('app.recent-diagnostics', { limit: 1 })).toMatchObject({
			value: [{ source: 'toast' }],
		});
		expect(await invoke('app.recent-diagnostics', { limit: 0 })).toEqual({
			ok: false,
			error: 'invalid args: `limit` must be a positive integer',
		});
		expect(
			await invoke('app.report-toast', { payload: { schemaVersion: 1, level: 'shout' } }),
		).toMatchObject({ ok: false, error: expect.stringContaining('invalid toast payload') });
	});

	it('serves the window, notification and update commands through the registry', async () => {
		const main = createFakeWindow();
		boot(context, { getMainWindow: () => asBrowserWindow(main.window) });

		expect(await invoke('app.focus-window')).toEqual({ ok: true, value: null });
		expect(main.calls).toEqual(['show', 'focus']);
		expect(await invoke('app.interface-scale', { scale: 1.1 })).toEqual({
			ok: true,
			value: null,
		});
		expect(main.zoom).toBe(1.1);
		expect(await invoke('app.logical-viewport')).toEqual({
			ok: true,
			value: { width: 1280, height: 800 },
		});
		expect(await invoke('app.close-guard', { armed: true })).toEqual({ ok: true, value: null });
		expect(main.emit('close').defaultPrevented).toBe(true);
		expect(await invoke('app.destroy-window')).toEqual({ ok: true, value: null });
		expect(main.destroyed).toBe(true);

		expect(await invoke('app.notify', { options: { title: 'Done', body: 'ws-1' } })).toEqual({
			ok: true,
			value: null,
		});
		expect(host.notifications).toEqual([{ title: 'Done', body: 'ws-1' }]);
		expect(await invoke('app.notification-permission-granted')).toEqual({
			ok: true,
			value: true,
		});
		expect(await invoke('app.request-notification-permission')).toEqual({
			ok: true,
			value: 'granted',
		});
	});
});
