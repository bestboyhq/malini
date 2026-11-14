import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { app, BrowserWindow, dialog } from 'electron';
import { BUNDLE_IDENTIFIER, bundleIdentifierFor } from '$lib/app/platform/runtime-identity';
import { declareWorktreeScheme } from '$lib/browser/platform/worktree-files';
import {
	checkoutsHome,
	moveCheckoutsHome,
	reinstallMovedCheckouts,
} from '$lib/shared/repositories/platform/checkouts-home';
import {
	serveWorkstreamImages,
	WORKSTREAM_IMAGE_SCHEME_PRIVILEGES,
} from '$lib/shared/repositories/platform/image-protocol';
import { COMMAND_NAMES, type CommandName } from '../contract/commands';
import type { MainContext } from './context';
import type { MaliniDatabase } from './db/driver';
import { openMigratedDatabase } from './db/open';
import { DbInvariantError } from './errors';
import { removeStaleTemporaryIndexes } from './git/diff';
import { withBundledGh } from './process/gh';
import { captureMainProcess, nodeProcessHooks } from './diagnostics/capture';
import { MainDiagnosticsLog } from './diagnostics/main-diagnostics';
import { createEventBus } from './events';
import { CommandRegistry } from './ipc/registry';
import { registerModules, type Modules } from './modules';
import { waitForPreviousInstanceToExit } from './single-instance';
import { pinStorageName } from './storage-name';
import {
	claimLinuxUrlScheme,
	claimsUrlScheme,
	linuxUrlHandler,
	URL_SCHEME,
	urlInbox,
	urlsIn,
} from './url-scheme';
import { BACKGROUND_WINDOW, createMainWindow } from './window';

const CHROMIUM_FEATURES_THAT_STALL_QUIT = ['DeclarativePerformanceObserver', 'DIPS'];

const productName = pinStorageName(app);
app.commandLine.appendSwitch('disable-features', CHROMIUM_FEATURES_THAT_STALL_QUIT.join(','));
if (BACKGROUND_WINDOW) {
	app.dock?.hide();
	app.disableHardwareAcceleration();
}
if (process.platform === 'win32') {
	app.setAppUserModelId(app.isPackaged ? BUNDLE_IDENTIFIER : process.execPath);
}
if (
	process.platform === 'linux' &&
	!BACKGROUND_WINDOW &&
	process.env['DBUS_SESSION_BUS_ADDRESS'] &&
	!/KDE/iu.test(process.env['XDG_CURRENT_DESKTOP'] ?? '') &&
	!app.commandLine.hasSwitch('password-store')
) {
	app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
}
declareWorktreeScheme([WORKSTREAM_IMAGE_SCHEME_PRIVILEGES]);

const diagnostics = new MainDiagnosticsLog({
	appDataRoot: app.getPath('userData'),
	runtime: {
		productName,
		bundleIdentifier: bundleIdentifierFor(!app.isPackaged),
		version: app.getVersion(),
		pid: process.pid,
	},
});
captureMainProcess(diagnostics, nodeProcessHooks());

const commands = new CommandRegistry();
let shuttingDown = false;
commands.observeFailures((failed) => {
	if (!shuttingDown) diagnostics.recordCommandFailure(failed);
});
const COMMANDS_CLOSE_BUDGET_MS = 5_000;

let db: MaliniDatabase | undefined;
let modules: Modules | undefined;
const urls = urlInbox();
const launchUrls = urlsIn(process.argv);
for (const url of launchUrls) urls.receive(url);

app.on('open-url', (event, url) => {
	event.preventDefault();
	urls.receive(url);
});

app.on('second-instance', (_event, argv) => {
	for (const url of urlsIn(argv)) urls.receive(url);
	const [window] = BrowserWindow.getAllWindows();
	if (!window) {
		if (modules) createMainWindow();
		return;
	}
	if (window.isMinimized()) window.restore();
	window.focus();
});

async function boot(): Promise<void> {
	if (!app.isPackaged && launchUrls.length === 0) {
		await waitForPreviousInstanceToExit(app.getPath('userData'));
	}
	if (!app.requestSingleInstanceLock()) {
		app.quit();
		return;
	}
	await app.whenReady();
	if (claimsUrlScheme(app.isPackaged, process.env)) claimUrlScheme();
	void removeStaleTemporaryIndexes();
	const appDataRoot = app.getPath('userData');
	const databasePath = join(appDataRoot, 'malini.sqlite');
	const freshInstall = !existsSync(databasePath);
	try {
		db = openMigratedDatabase(databasePath);
	} catch (error) {
		const detail = error instanceof DbInvariantError ? error.detail : String(error);
		console.error(`Malini could not open its database: ${detail}`);
		if (!BACKGROUND_WINDOW) dialog.showErrorBox('Malini could not open its database', detail);
		app.exit(1);
		return;
	}

	const checkoutsRoot = await moveCheckoutsHome({
		db,
		appDataRoot,
		defaultRoot: checkoutsHome(appDataRoot, app.commandLine.hasSwitch('user-data-dir')),
	});
	const context: MainContext = {
		db,
		commands,
		events: createEventBus(),
		appDataRoot,
		checkoutsRoot,
		resourcesRoot: app.isPackaged ? process.resourcesPath : join(__dirname, '../..'),
		isDev: !app.isPackaged,
		appVersion: app.getVersion(),
	};
	process.env.PATH = withBundledGh(process.env.PATH, context.resourcesRoot, context.appDataRoot);
	const bridgeScriptPath = testBridgeScript();
	modules = await registerModules(context, {
		getMainWindow: () => BrowserWindow.getAllWindows()[0] ?? null,
		freshInstall,
		...(bridgeScriptPath ? { overrides: { bridgeScriptPath } } : {}),
	});
	serveWorkstreamImages(modules.repositories.media);
	urls.deliverTo(modules.openUrl);
	if (context.isDev) assertContractIsRegistered(context.commands.names());
	context.commands.install();
	createMainWindow();
	void reinstallMovedCheckouts(db, context.commands);

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
	});
}

function assertContractIsRegistered(registered: readonly CommandName[]): void {
	const declared = new Set<string>(COMMAND_NAMES);
	const present = new Set<string>(registered);
	const missing = [...declared].filter((name) => !present.has(name)).sort();
	const unexpected = [...present].filter((name) => !declared.has(name)).sort();
	if (missing.length === 0 && unexpected.length === 0) return;
	throw new Error(
		`the command registry does not match the contract: ${missing.length} declared but not registered (${missing.join(', ')}), ${unexpected.length} registered but not declared (${unexpected.join(', ')})`,
	);
}

function claimUrlScheme(): void {
	if (process.platform === 'linux') {
		const handler = linuxUrlHandler(app.isPackaged, process.env, process.execPath, app.getAppPath());
		if (!handler) return;
		claimLinuxUrlScheme(handler, process.env).catch((error: unknown) => {
			console.error('malini: could not claim malini:// links', error);
		});
	} else if (process.platform === 'win32' && !app.isPackaged) {
		app.setAsDefaultProtocolClient(URL_SCHEME, process.execPath, [app.getAppPath()]);
	} else {
		app.setAsDefaultProtocolClient(URL_SCHEME);
	}
}

function testBridgeScript(): string | undefined {
	return app.isPackaged ? undefined : process.env['MALINI_BRIDGE_SCRIPT'];
}

void boot();

const keepRunningWithoutWindows = (): void => undefined;
app.on('window-all-closed', keepRunningWithoutWindows);

app.on('will-quit', (event) => {
	if (shuttingDown || !modules) {
		db?.close();
		db = undefined;
		return;
	}
	event.preventDefault();
	shuttingDown = true;
	void quit(modules);
});

async function quit(running: Modules): Promise<void> {
	try {
		await running.shutdown();
	} catch (error) {
		console.error('malini: shutdown failed', error);
	}
	try {
		await Promise.race([commands.close(), delay(COMMANDS_CLOSE_BUDGET_MS)]);
	} finally {
		db?.close();
		db = undefined;
		running.app.exit();
	}
}
