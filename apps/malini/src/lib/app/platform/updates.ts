import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
	app,
	autoUpdater as squirrel,
	dialog,
	powerMonitor,
	type MenuItemConstructorOptions,
} from 'electron';
import electronUpdater from 'electron-updater';
import { APP_UPDATE_STAGED_CHANNEL } from '$contract/events';
import type { MainContext } from '$main/context';
import { describeError } from '$main/errors';
import { BACKGROUND_WINDOW } from '$main/window';

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

type UpdateState = 'idle' | 'checking' | 'downloading' | 'ready';

const MENU_LABELS: Record<Exclude<UpdateState, 'ready'>, string> = {
	idle: 'Check for Updates…',
	checking: 'Checking for Updates…',
	downloading: 'Downloading Update…',
};

export interface Updates {
	exit(): void;
}

export function startUpdates(
	{ commands, events }: Pick<MainContext, 'commands' | 'events'>,
	showUpdateItem: (item: MenuItemConstructorOptions) => void,
): Updates {
	const exitNow = (): void => app.exit(0);
	let staged = '';
	let restartToLatest = (): void => {
		throw new Error('no update is ready to install');
	};
	commands.define('app.staged-update', () => staged || null);
	commands.define('app.restart-to-update', () => restartToLatest());
	if (!app.isPackaged || !existsSync(join(process.resourcesPath, 'app-update.yml'))) {
		return { exit: exitNow };
	}
	if (!BACKGROUND_WINDOW && !app.isInApplicationsFolder() && offerMoveToApplications()) {
		return { exit: exitNow };
	}

	const { autoUpdater } = electronUpdater;
	autoUpdater.logger = null;
	autoUpdater.autoDownload = false;
	let state: UpdateState = 'idle';
	let downloading = '';
	let asked = false;
	let restartOnceLatest = false;
	let restartRequested = false;

	const say = (message: string, detail: string): void => {
		if (!BACKGROUND_WINDOW) void dialog.showMessageBox({ message, detail });
	};
	const restart = (): void => {
		restartRequested = true;
		app.quit();
	};
	restartToLatest = (): void => {
		restartOnceLatest = true;
		void check();
	};
	const menuItem = (): MenuItemConstructorOptions =>
		state === 'ready'
			? { label: 'Restart to Update', click: restartToLatest }
			: {
					label: MENU_LABELS[state],
					enabled: state === 'idle',
					click: () => {
						asked = true;
						void check();
					},
				};
	const set = (next: UpdateState): void => {
		state = next;
		showUpdateItem(menuItem());
	};
	const settle = (): void => {
		set(staged ? 'ready' : 'idle');
		if (restartOnceLatest) restart();
	};

	const check = async (): Promise<void> => {
		if (state === 'checking' || state === 'downloading') return;
		set('checking');
		try {
			const result = await autoUpdater.checkForUpdates();
			const latest = result?.isUpdateAvailable ? result.updateInfo.version : staged;
			if (latest === staged) {
				settle();
				if (asked) say('Malini is up to date.', `Version ${app.getVersion()} is the latest.`);
				asked = false;
				return;
			}
			downloading = latest;
			set('downloading');
			autoUpdater.downloadUpdate().catch(() => {});
		} catch (error) {
			settle();
			if (asked) say('Malini could not check for updates.', describeError(error));
			asked = false;
		}
	};

	autoUpdater.on('error', (error) => {
		console.warn('malini: update failed', error);
		if (state !== 'downloading') return;
		settle();
		if (asked) say('Malini could not download the update.', describeError(error));
		asked = false;
	});
	const offerRestart = async (): Promise<void> => {
		const { response } = await dialog.showMessageBox({
			message: `Malini ${staged} is ready to install.`,
			detail: 'Restart now, or it installs the next time you quit Malini.',
			buttons: ['Restart to Update', 'Later'],
			defaultId: 0,
			cancelId: 1,
		});
		if (response === 0) restart();
	};
	squirrel.on('update-downloaded', () => {
		staged = downloading;
		settle();
		events.emit(APP_UPDATE_STAGED_CHANNEL, { version: staged });
		if (!asked || restartOnceLatest || BACKGROUND_WINDOW) return;
		asked = false;
		void offerRestart();
	});

	set('idle');
	void check();
	setInterval(() => void check(), CHECK_INTERVAL_MS);
	powerMonitor.on('resume', () => void check());

	return {
		exit: () => {
			if (!restartRequested || state !== 'ready') return exitNow();
			autoUpdater.once('error', exitNow);
			autoUpdater.quitAndInstall();
		},
	};
}

function offerMoveToApplications(): boolean {
	const response = dialog.showMessageBoxSync({
		message: 'Move Malini to your Applications folder?',
		detail: 'Malini can only update itself from there.',
		buttons: ['Move to Applications', 'Not Now'],
		defaultId: 0,
		cancelId: 1,
	});
	if (response !== 0) return false;
	try {
		return app.moveToApplicationsFolder();
	} catch (error) {
		dialog.showErrorBox('Malini could not move itself.', describeError(error));
		return false;
	}
}
