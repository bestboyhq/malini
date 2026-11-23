import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', async () => {
	const { EventEmitter } = await import('node:events');
	return {
		app: {
			isPackaged: true,
			isInApplicationsFolder: () => true,
			getVersion: () => '1.0.0',
			quit: () => undefined,
			exit: () => undefined,
			relaunch: () => undefined,
		},
		autoUpdater: new EventEmitter(),
		dialog: {},
		powerMonitor: new EventEmitter(),
		BrowserWindow: { getAllWindows: () => [] },
		screen: {},
		shell: {},
	};
});

const releases = vi.hoisted(() => ({
	latest: (): Promise<UpdateInfo> => new Promise(() => undefined),
	asked: 0,
}));

vi.mock('electron-updater', async (importOriginal) => {
	const actual = await importOriginal<typeof import('electron-updater')>();
	const { mkdtempSync: folder } = await import('node:fs');
	const { tmpdir: temporary } = await import('node:os');
	const { join: joined } = await import('node:path');
	class LatestRelease extends actual.Provider<UpdateInfo> {
		constructor(_options: unknown, _updater: unknown, runtimeOptions: ProviderRuntimeOptions) {
			super(runtimeOptions);
		}
		getLatestVersion(): Promise<UpdateInfo> {
			releases.asked += 1;
			return releases.latest();
		}
		resolveFiles(): [] {
			return [];
		}
	}
	class Updater extends actual.AppUpdater {
		constructor(userData: string) {
			super(
				{ provider: 'custom', updateProvider: LatestRelease },
				{
					version: '1.0.0',
					name: 'Malini',
					isPackaged: true,
					appUpdateConfigPath: joined(userData, 'app-update.yml'),
					userDataPath: userData,
					baseCachePath: userData,
					whenReady: () => Promise.resolve(),
					relaunch: () => undefined,
					quit: () => undefined,
					onQuit: () => undefined,
				},
			);
		}
		protected doDownloadUpdate(): Promise<string[]> {
			return new Promise(() => undefined);
		}
		quitAndInstall(): void {
			return;
		}
	}
	const autoUpdater = new Updater(folder(joined(temporary(), 'malini-updater-')));
	return { default: { autoUpdater, CancellationToken: actual.CancellationToken } };
});

import { autoUpdater as squirrel } from 'electron';
import electronUpdater, { type CancellationToken, type UpdateInfo } from 'electron-updater';
import type { ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider';
import { APP_UPDATE_STATUS_CHANGED_CHANNEL, type UpdateStatus } from '$contract/events';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import { startUpdates } from './updates';

const { autoUpdater } = electronUpdater;

const release = (version: string): Promise<UpdateInfo> =>
	Promise.resolve({ version, files: [], path: '', sha512: '', releaseDate: '' });

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	Reflect.deleteProperty(process, 'resourcesPath');
});

describe('updates', () => {
	it('gives up on a download that stops moving, and checks again later', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
		const resources = mkdtempSync(join(tmpdir(), 'malini-updates-'));
		writeFileSync(join(resources, 'app-update.yml'), 'provider: github\n');
		Object.defineProperty(process, 'resourcesPath', { value: resources, configurable: true });
		releases.latest = () => release('2.0.0');
		const tokens: CancellationToken[] = [];
		const downloads = vi.spyOn(autoUpdater, 'downloadUpdate').mockImplementation((token) => {
			if (token) tokens.push(token);
			return new Promise(() => undefined);
		});
		const commands = new CommandRegistry();
		const events = createEventBus({ forwardToWindows: false });
		const shown: UpdateStatus[] = [];
		events.subscribe(APP_UPDATE_STATUS_CHANGED_CHANNEL, (status) => shown.push(status));
		startUpdates({ commands, events }, () => undefined);

		await vi.waitFor(() => expect(downloads).toHaveBeenCalledTimes(1));
		await commands.call('app.check-for-updates', undefined);
		await vi.advanceTimersByTimeAsync(4 * 60_000);
		autoUpdater.emit('download-progress', {
			total: 100,
			delta: 40,
			transferred: 40,
			percent: 40,
			bytesPerSecond: 1,
		});
		await vi.advanceTimersByTimeAsync(4 * 60_000);
		expect(await commands.call('app.update-status', undefined)).toEqual({
			state: 'downloading',
			version: '2.0.0',
		});

		await vi.advanceTimersByTimeAsync(2 * 60_000);
		expect(await commands.call('app.update-status', undefined)).toMatchObject({ state: 'failed' });
		expect(tokens[0]?.cancelled).toBe(true);
		expect(shown.map(({ state }) => state)).toEqual(['downloading', 'failed']);

		await vi.advanceTimersByTimeAsync(60 * 60_000);
		await vi.waitFor(() => expect(downloads).toHaveBeenCalledTimes(2));
	});

	it('lists what changed since this version once an update is ready', async () => {
		const resources = mkdtempSync(join(tmpdir(), 'malini-updates-'));
		writeFileSync(join(resources, 'app-update.yml'), 'provider: github\n');
		Object.defineProperty(process, 'resourcesPath', { value: resources, configurable: true });
		releases.latest = () =>
			Promise.resolve({
				version: '1.2.0',
				files: [],
				path: '',
				sha512: '',
				releaseDate: '',
				releaseNotes: [
					{ version: '1.2.0', note: '<ul><li>feat(chat): pin a chat by @octo in #2</li></ul>' },
					{ version: '1.1.0', note: '<ul><li>fix: keep the clock right by @octo in #1</li></ul>' },
				],
			});
		const downloads = vi.spyOn(autoUpdater, 'downloadUpdate').mockResolvedValue([]);
		const commands = new CommandRegistry();
		const events = createEventBus({ forwardToWindows: false });
		startUpdates({ commands, events }, () => undefined);

		await vi.waitFor(() => expect(downloads).toHaveBeenCalledTimes(1));
		squirrel.emit('update-downloaded');

		expect(await commands.call('app.update-status', undefined)).toEqual({
			state: 'ready',
			version: '1.2.0',
			installed: '1.0.0',
			releases: [
				{ version: '1.2.0', changes: [{ kind: 'feature', summary: 'Pin a chat' }] },
				{ version: '1.1.0', changes: [{ kind: 'fix', summary: 'Keep the clock right' }] },
			],
		});
	});

	it('checks again after a check that never answers', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
		const resources = mkdtempSync(join(tmpdir(), 'malini-updates-'));
		writeFileSync(join(resources, 'app-update.yml'), 'provider: github\n');
		Object.defineProperty(process, 'resourcesPath', { value: resources, configurable: true });
		releases.asked = 0;
		releases.latest = () => new Promise(() => undefined);
		const commands = new CommandRegistry();
		const events = createEventBus({ forwardToWindows: false });
		startUpdates({ commands, events }, () => undefined);

		await vi.waitFor(() => expect(releases.asked).toBe(1));
		await vi.advanceTimersByTimeAsync(5 * 60_000);
		releases.latest = () => release('1.0.0');
		await commands.call('app.check-for-updates', undefined);

		await vi.waitFor(async () =>
			expect(await commands.call('app.update-status', undefined)).toEqual({
				state: 'up-to-date',
				version: '1.0.0',
			}),
		);
		expect(releases.asked).toBe(2);
	});
});
