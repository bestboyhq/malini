import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import type { RecentDiagnosticsArgs, ReportToastArgs } from '$contract/diagnostics';
import type {
	AppendRendererErrorArgs,
	CloseGuardArgs,
	NotifyArgs,
	OpenExternalUrlArgs,
	SecretKeyArgs,
	SetClipboardImageArgs,
	SetClipboardTextArgs,
	SetInterfaceScaleArgs,
	SetSecretArgs,
	SetThemeModeArgs,
	ThemeMode,
} from '$contract/commands';
import { CONTRACT_REFERENCE } from '$contract/contract-reference.generated';
import type { MainContext } from '$main/context';
import { readDiagnostics } from '$main/diagnostics/diagnostics-files';
import type { DockerOwnership } from '$main/docker/ownership';
import { DockerCliReaper, type ContainerReaper } from '$main/docker/reclaim';
import { createNodeProcessRunner, processIsAlive, type ProcessRunner } from '$main/process/runner';
import type { AppPlatform } from '../app.platform';
import {
	ConfirmedShutdown,
	openAgentRunCount,
	readShutdownImpact,
	type ShutdownChildren,
	type ShutdownImpactSources,
} from './graceful-shutdown';
import { announceUpdate } from './contract-updates';
import { RendererErrorLog } from './renderer-errors';
import { bundleIdentifierFor, createRuntimeIdentityProvider } from './runtime-identity';
import { RendererSecretStore } from './secrets';
import { listSettings, setSetting } from './settings.repository';
import { createElectronShellHost, type ShellHost } from './shell-host';
import { StreamingDetector } from './streaming';
import { startUpdates } from './updates';
import { startUsageData } from './usage-data';
import { createWindowCommands, type WindowCommands } from './window';

export interface AppDeps {
	getMainWindow(): BrowserWindow | null;
	readonly host?: ShellHost;
	readonly ownership: DockerOwnership;
	readonly runner?: ProcessRunner;
	readonly reaper?: ContainerReaper;
	readonly cancelAgentRuns?: () => Promise<number> | number;
	readonly containerCount?: () => number;
	readonly sessionModel?: (sessionId: string) => string | null;
}

export function registerApp(context: MainContext, deps: AppDeps): AppPlatform {
	const host = deps.host ?? createElectronShellHost();
	const window = defineShellCommands(context, deps, host);
	defineSettingsCommands(context);
	const usageData = startUsageData(context, {
		host,
		sessionModel: deps.sessionModel ?? (() => null),
	});
	const updates = startUpdates(context);
	return {
		...defineShutdownCommands(context, deps),
		shutdownUsageData: () => usageData.shutdown(),
		windowStateSaved: () => window.windowStateSaved(),
		exit: () => updates.exit(),
		announceUpdate: () => announceUpdate(context, CONTRACT_REFERENCE),
		streaming: new StreamingDetector(context, deps.runner ?? createNodeProcessRunner()),
	};
}

function defineShellCommands(context: MainContext, deps: AppDeps, host: ShellHost): WindowCommands {
	const { commands, events } = context;
	const bundleIdentifier = bundleIdentifierFor(context.isDev);

	const secrets = new RendererSecretStore(context.appDataRoot, host);
	commands.define('app.get-secret', (args: SecretKeyArgs) => secrets.get(args?.service, args?.key));
	commands.define('app.set-secret', (args: SetSecretArgs) =>
		secrets.set(args?.service, args?.key, args?.value),
	);
	commands.define('app.delete-secret', (args: SecretKeyArgs) =>
		secrets.delete(args?.service, args?.key),
	);

	commands.define('app.open-external-url', async (args: OpenExternalUrlArgs) => {
		const url = args?.url;
		if (typeof url !== 'string' || url.length === 0) throw new Error('url must be a string');
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			throw new Error(`not a URL: ${url}`);
		}
		if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
			throw new Error(`refusing to open a ${parsed.protocol} URL`);
		}
		await host.openExternal(url);
	});
	commands.define('app.theme-mode', (args: SetThemeModeArgs) =>
		host.followThemeMode(themeMode(args?.mode)),
	);
	commands.define('app.copy-text', async (args: SetClipboardTextArgs) => {
		if (typeof args?.text !== 'string') throw new Error('text must be a string');
		if (args.html !== undefined && typeof args.html !== 'string') {
			throw new Error('html must be a string');
		}
		await host.clipboardWriteText(args.text, args.html);
	});
	commands.define('app.copy-image', async (args: SetClipboardImageArgs) => {
		const pngDataUrl = args?.pngDataUrl;
		if (typeof pngDataUrl !== 'string' || !pngDataUrl.startsWith(PNG_DATA_URL)) {
			throw new Error('pngDataUrl must be a PNG data URL');
		}
		const png = Buffer.from(pngDataUrl.slice(PNG_DATA_URL.length), 'base64');
		if (!png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
			throw new Error('pngDataUrl must be a PNG data URL');
		}
		await host.clipboardWriteImage(png);
	});

	const runtimeIdentity = createRuntimeIdentityProvider({
		productName: host.productName,
		version: context.appVersion,
		isDev: context.isDev,
		executablePath: host.executablePath,
		appDataRoot: context.appDataRoot,
	});
	commands.define('app.runtime-identity', () => runtimeIdentity());
	commands.define('app.runtime-info', () => ({
		app: context.appVersion,
		electron: process.versions.electron ?? '',
		node: process.versions.node,
		chrome: process.versions.chrome ?? '',
		sqlite: context.db.sqliteVersion(),
		dataDirectory: context.appDataRoot,
	}));

	const rendererErrors = new RendererErrorLog(context.appDataRoot, {
		productName: host.productName,
		bundleIdentifier,
		version: context.appVersion,
		pid: process.pid,
	});
	commands.define('app.report-renderer-error', (args: AppendRendererErrorArgs) =>
		rendererErrors.persist(args?.payload),
	);
	commands.define('app.report-toast', (args: ReportToastArgs) =>
		rendererErrors.persistToast(args?.payload),
	);
	commands.define('app.recent-diagnostics', (args: RecentDiagnosticsArgs) =>
		readDiagnostics(context.appDataRoot, {
			minimumLevel: 'warn',
			withToasts: true,
			limit: recentDiagnosticsLimit(args?.limit),
		}).reverse(),
	);

	const window = createWindowCommands({
		getMainWindow: () => deps.getMainWindow(),
		host,
		events,
		appDataRoot: context.appDataRoot,
	});
	commands.define('app.focus-window', () => window.focusMainWindow());
	commands.define('app.interface-scale', (args: SetInterfaceScaleArgs) =>
		window.setInterfaceScale(args),
	);
	commands.define('app.logical-viewport', () => window.logicalViewport());
	commands.define('app.close-guard', (args: CloseGuardArgs) => window.setCloseGuard(args));
	commands.define('app.destroy-window', () => window.destroy());
	commands.define('app.notify', (args: NotifyArgs) => window.notify(args));
	commands.define('app.take-notification-target', () => window.takeNotificationTarget());
	commands.define('app.take-connect-repository-request', () =>
		window.takeConnectRepositoryRequest(),
	);
	host.showTray(join(context.resourcesRoot, 'build', 'tray', 'trayTemplate.png'), [
		{ label: 'Open Folder…', click: () => window.requestConnectRepository('folder') },
		{ label: 'Clone Repository…', click: () => window.requestConnectRepository('clone') },
	]);
	commands.define('app.notification-permission-granted', () =>
		window.isNotificationPermissionGranted(),
	);
	commands.define('app.request-notification-permission', () =>
		window.requestNotificationPermission(),
	);
	return window;
}

function defineSettingsCommands(context: MainContext): void {
	const { db, commands } = context;

	commands.define('app.list-settings', (): Record<string, string> => listSettings(db));

	commands.define('app.set-setting', (args: unknown): void => {
		setSetting(db, requireString(args, 'key'), requireString(args, 'value'));
	});
}

function defineShutdownCommands(
	context: MainContext,
	deps: AppDeps,
): Pick<AppPlatform, 'shutdownGracefully' | 'shutdownImpact'> {
	const { db, commands } = context;
	const runner = deps.runner ?? createNodeProcessRunner();
	const reaper = deps.reaper ?? new DockerCliReaper(runner);
	const children: ShutdownChildren = {
		cancelAgentRuns: deps.cancelAgentRuns ?? (() => 0),
	};
	const shutdown = new ConfirmedShutdown({
		db,
		ownership: deps.ownership,
		reaper,
		children,
		ownerIsAlive: processIsAlive,
	});
	const impactSources: Partial<ShutdownImpactSources> = {
		agentRuns: () => openAgentRunCount(db),
		...(deps.containerCount ? { containers: deps.containerCount } : {}),
	};

	const platform: Pick<AppPlatform, 'shutdownGracefully' | 'shutdownImpact'> = {
		shutdownGracefully: (budgetMs) => shutdown.run(budgetMs),
		shutdownImpact: () => readShutdownImpact(impactSources),
	};

	commands.define('app.shutdown-gracefully', () => platform.shutdownGracefully());
	commands.define('app.shutdown-impact', () => platform.shutdownImpact());

	return platform;
}

const MAX_RECENT_DIAGNOSTICS = 200;
const PNG_DATA_URL = 'data:image/png;base64,';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function recentDiagnosticsLimit(requested: unknown): number {
	if (typeof requested !== 'number' || !Number.isInteger(requested) || requested < 1) {
		throw new Error('invalid args: `limit` must be a positive integer');
	}
	return Math.min(requested, MAX_RECENT_DIAGNOSTICS);
}

function requireString(args: unknown, key: string): string {
	const value = typeof args === 'object' && args !== null ? Reflect.get(args, key) : undefined;
	if (typeof value !== 'string') throw new Error(`invalid args: \`${key}\` must be a string`);
	return value;
}

const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

function themeMode(mode: unknown): ThemeMode {
	const known = THEME_MODES.find((candidate) => candidate === mode);
	if (!known) throw new Error('theme mode must be system, light or dark');
	return known;
}
