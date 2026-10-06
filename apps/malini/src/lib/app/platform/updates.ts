import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
	app,
	autoUpdater as squirrel,
	dialog,
	Menu,
	powerMonitor,
	type MenuItemConstructorOptions,
} from 'electron';
import electronUpdater from 'electron-updater';
import { describeError } from '$main/errors';
import { BACKGROUND_WINDOW } from '$main/window';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

type UpdateState = 'idle' | 'checking' | 'downloading' | 'ready';

const MENU_LABELS: Record<Exclude<UpdateState, 'ready'>, string> = {
	idle: 'Check for Updates…',
	checking: 'Checking for Updates…',
	downloading: 'Downloading Update…',
};

export interface Updates {
	exit(): void;
}

export function startUpdates(): Updates {
	const exitNow = (): void => app.exit(0);
	if (!app.isPackaged || !existsSync(join(process.resourcesPath, 'app-update.yml'))) {
		return { exit: exitNow };
	}
	if (!BACKGROUND_WINDOW && !app.isInApplicationsFolder() && offerMoveToApplications()) {
		return { exit: exitNow };
	}

	const { autoUpdater } = electronUpdater;
	autoUpdater.logger = null;
	let state: UpdateState = 'idle';
	let version = '';
	let asked = false;
	let restartRequested = false;

	const say = (message: string, detail: string): void => {
		if (!BACKGROUND_WINDOW) void dialog.showMessageBox({ message, detail });
	};
	const restart = (): void => {
		restartRequested = true;
		app.quit();
	};
	const menuItem = (): MenuItemConstructorOptions =>
		state === 'ready'
			? { label: 'Restart to Update', click: restart }
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
		Menu.setApplicationMenu(applicationMenu(menuItem()));
	};

	const check = async (): Promise<void> => {
		if (state !== 'idle') return;
		set('checking');
		try {
			const result = await autoUpdater.checkForUpdates();
			if (!result?.isUpdateAvailable) {
				set('idle');
				if (asked) say('malini is up to date.', `Version ${app.getVersion()} is the latest.`);
				asked = false;
				return;
			}
			version = result.updateInfo.version;
			set('downloading');
			result.downloadPromise?.catch(() => {});
		} catch (error) {
			set('idle');
			if (asked) say('malini could not check for updates.', describeError(error));
			asked = false;
		}
	};

	autoUpdater.on('error', (error) => {
		console.warn('malini: update failed', error);
		if (state !== 'downloading') return;
		set('idle');
		if (asked) say('malini could not download the update.', describeError(error));
		asked = false;
	});
	const offerRestart = async (): Promise<void> => {
		const { response } = await dialog.showMessageBox({
			message: `malini ${version} is ready to install.`,
			detail: 'Restart now, or it installs the next time you quit malini.',
			buttons: ['Restart to Update', 'Later'],
			defaultId: 0,
			cancelId: 1,
		});
		if (response === 0) restart();
	};
	squirrel.on('update-downloaded', () => {
		set('ready');
		if (!asked || BACKGROUND_WINDOW) return;
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
		message: 'Move malini to your Applications folder?',
		detail: 'malini can only update itself from there.',
		buttons: ['Move to Applications', 'Not Now'],
		defaultId: 0,
		cancelId: 1,
	});
	if (response !== 0) return false;
	try {
		return app.moveToApplicationsFolder();
	} catch (error) {
		dialog.showErrorBox('malini could not move itself.', describeError(error));
		return false;
	}
}

function applicationMenu(update: MenuItemConstructorOptions): Menu {
	return Menu.buildFromTemplate([
		{
			label: app.name,
			submenu: [
				{ role: 'about' },
				update,
				{ type: 'separator' },
				{ role: 'services' },
				{ type: 'separator' },
				{ role: 'hide' },
				{ role: 'hideOthers' },
				{ role: 'unhide' },
				{ type: 'separator' },
				{ role: 'quit' },
			],
		},
		{ role: 'fileMenu' },
		{ role: 'editMenu' },
		{ role: 'viewMenu' },
		{ role: 'windowMenu' },
	]);
}
