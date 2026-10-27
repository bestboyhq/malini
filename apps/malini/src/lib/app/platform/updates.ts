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
import {
	APP_UPDATE_STAGED_CHANNEL,
	APP_UPDATE_STATUS_CHANGED_CHANNEL,
	type UpdateStatus,
} from '$contract/events';
import type { MainContext } from '$main/context';
import { describeError } from '$main/errors';
import { BACKGROUND_WINDOW } from '$main/window';

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const UP_TO_DATE_SHOWN_MS = 8_000;
const IDLE: UpdateStatus = { state: 'idle' };

export interface Updates {
	exit(): void;
}

export function startUpdates(
	{ commands, events }: Pick<MainContext, 'commands' | 'events'>,
	showUpdateItem: (item: MenuItemConstructorOptions) => void,
): Updates {
	const exitNow = (): void => app.exit(0);
	let shown = IDLE;
	let checkNow = (): void => {
		throw new Error('this build does not update itself');
	};
	let restartToLatest = (): void => {
		throw new Error('no update is ready to install');
	};
	commands.define('app.update-status', () => shown);
	commands.define('app.check-for-updates', () => checkNow());
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
	let activity: UpdateStatus | null = null;
	let outcome: UpdateStatus | null = null;
	let staged = '';
	let asked = false;
	let restartOnceLatest = false;
	let restartRequested = false;

	const show = (): void => {
		const next =
			(asked && activity) ||
			(staged ? { state: 'ready' as const, version: staged } : (outcome ?? IDLE));
		if (JSON.stringify(next) === JSON.stringify(shown)) return;
		shown = next;
		events.emit(APP_UPDATE_STATUS_CHANGED_CHANNEL, next);
	};
	const restart = (): void => {
		restartRequested = true;
		app.quit();
	};
	checkNow = (): void => {
		asked = true;
		show();
		void check();
	};
	restartToLatest = (): void => {
		restartOnceLatest = true;
		void check();
	};
	const settle = (result: UpdateStatus | null): void => {
		activity = null;
		outcome = asked ? result : null;
		asked = false;
		show();
		if (result?.state === 'up-to-date') {
			setTimeout(() => {
				if (outcome !== result) return;
				outcome = null;
				show();
			}, UP_TO_DATE_SHOWN_MS);
		}
		if (restartOnceLatest) restart();
	};

	const check = async (): Promise<void> => {
		if (activity) return;
		activity = { state: 'checking' };
		show();
		try {
			const result = await autoUpdater.checkForUpdates();
			const latest = result?.isUpdateAvailable ? result.updateInfo.version : staged;
			if (latest === staged) return settle({ state: 'up-to-date', version: app.getVersion() });
			activity = { state: 'downloading', version: latest };
			show();
			autoUpdater.downloadUpdate().catch(() => {});
		} catch (error) {
			settle({ state: 'failed', error: describeError(error) });
		}
	};

	autoUpdater.on('error', (error) => {
		console.warn('malini: update failed', error);
		if (activity?.state !== 'downloading') return;
		settle({ state: 'failed', error: describeError(error) });
	});
	squirrel.on('update-downloaded', () => {
		if (activity?.state !== 'downloading') return;
		staged = activity.version;
		events.emit(APP_UPDATE_STAGED_CHANNEL, { version: staged });
		settle(null);
	});

	showUpdateItem({ label: 'Check for Updates…', click: checkNow });
	void check();
	setInterval(() => void check(), CHECK_INTERVAL_MS);
	powerMonitor.on('resume', () => void check());

	return {
		exit: () => {
			if (!restartRequested || !staged || activity) return exitNow();
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
