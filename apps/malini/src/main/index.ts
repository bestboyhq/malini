import { join } from 'node:path';
import { app, BrowserWindow, dialog } from 'electron';
import { bundleIdentifierFor } from '$lib/app/platform/runtime-identity';
import { COMMAND_NAMES, type CommandName } from '../contract/commands';
import type { MainContext } from './context';
import type { MaliniDatabase } from './db/driver';
import { openMigratedDatabase } from './db/open';
import { captureMainProcess, nodeProcessHooks } from './diagnostics/capture';
import { MainDiagnosticsLog } from './diagnostics/main-diagnostics';
import { createEventBus } from './events';
import { CommandRegistry } from './ipc/registry';
import { registerModules, type Modules } from './modules';
import { adoptLegacyAppData, DATABASE_FILE_NAME } from './legacy-app-data';
import { waitForPreviousInstanceToExit } from './single-instance';
import { BACKGROUND_WINDOW, createMainWindow } from './window';

if (BACKGROUND_WINDOW) app.dock?.hide();

const appDataProblem = adoptLegacyAppData(app.getPath('userData'));
if (appDataProblem) {
	dialog.showErrorBox('malini could not start', appDataProblem);
	process.exit(1);
}

const diagnostics = new MainDiagnosticsLog({
	appDataRoot: app.getPath('userData'),
	runtime: {
		productName: app.getName(),
		bundleIdentifier: bundleIdentifierFor(!app.isPackaged),
		version: app.getVersion(),
		pid: process.pid,
	},
});
captureMainProcess(diagnostics, nodeProcessHooks());

let db: MaliniDatabase | undefined;
let modules: Modules | undefined;

app.on('second-instance', () => {
	const [window] = BrowserWindow.getAllWindows();
	if (!window) return;
	if (window.isMinimized()) window.restore();
	window.focus();
});

async function boot(): Promise<void> {
	if (!app.isPackaged) await waitForPreviousInstanceToExit(app.getPath('userData'));
	if (!app.requestSingleInstanceLock()) {
		app.quit();
		return;
	}
	await app.whenReady();
	if (!app.isPackaged && process.platform === 'darwin') {
		app.dock?.setIcon(join(__dirname, '../../build/icon.png'));
	}
	const appDataRoot = app.getPath('userData');
	db = openMigratedDatabase(join(appDataRoot, DATABASE_FILE_NAME));

	const commands = new CommandRegistry();
	commands.observeFailures((failed) => diagnostics.recordCommandFailure(failed));
	const context: MainContext = {
		db,
		commands,
		events: createEventBus(),
		appDataRoot,
		resourcesRoot: app.isPackaged ? process.resourcesPath : join(__dirname, '../..'),
		isDev: !app.isPackaged,
		appVersion: app.getVersion(),
	};
	const bridgeScriptPath = testBridgeScript();
	modules = await registerModules(context, {
		getMainWindow: () => BrowserWindow.getAllWindows()[0] ?? null,
		...(bridgeScriptPath ? { overrides: { bridgeScriptPath } } : {}),
	});
	if (context.isDev) assertContractIsRegistered(context.commands.names());
	context.commands.install();
	createMainWindow();

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

function testBridgeScript(): string | undefined {
	return app.isPackaged ? undefined : process.env['MALINI_BRIDGE_SCRIPT'];
}

void boot();

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});

let shuttingDown = false;
app.on('will-quit', (event) => {
	if (shuttingDown || !modules) {
		db?.close();
		db = undefined;
		return;
	}
	event.preventDefault();
	shuttingDown = true;
	void modules
		.shutdown()
		.catch((error: unknown) => {
			console.error('malini: shutdown failed', error);
		})
		.finally(() => {
			db?.close();
			db = undefined;
			app.exit(0);
		});
});
