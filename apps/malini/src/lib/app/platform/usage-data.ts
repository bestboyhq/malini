import { app, type BrowserWindow } from 'electron';
import { PostHog, uuidv7 } from 'posthog-node';
import { CHAT_AGENT_EVENT_CHANNEL } from '$contract/events';
import type { MainContext } from '$main/context';
import { USAGE_DATA_SETTING, usageDataShared } from '../domain/usage-data';
import { getSetting, setSetting } from './settings.repository';
import type { ShellHost } from './shell-host';
import { commandUsage, RunUsage, screenOf, type UsageProperties } from './usage-events';

export interface UsageMessage {
	readonly distinctId: string;
	readonly event: string;
	readonly properties: Readonly<Record<string, unknown>>;
}

export interface UsageSink {
	capture(message: UsageMessage): void;
	shutdown(timeoutMs?: number): Promise<void>;
}

export interface UsageData {
	shutdown(): Promise<void>;
}

export interface UsageDataDeps {
	readonly host: Pick<ShellHost, 'onWindowCreated'>;
	readonly sink?: UsageSink | null;
	readonly system?: UsageProperties;
	readonly now?: () => number;
	sessionModel(sessionId: string): string | null;
}

export const INSTALL_ID_SETTING = 'usage-data.install-id';

const SESSION_IDLE_MS = 30 * 60 * 1000;
const SHUTDOWN_FLUSH_MS = 2000;

const OS_NAMES: Readonly<Partial<Record<NodeJS.Platform, string>>> = {
	darwin: 'Mac OS X',
	win32: 'Windows',
	linux: 'Linux',
};

export function startUsageData(context: MainContext, deps: UsageDataDeps): UsageData {
	const sink = deps.sink === undefined ? postHogSink() : deps.sink;
	if (!sink) return { shutdown: () => Promise.resolve() };
	const now = deps.now ?? Date.now;
	const system = deps.system ?? systemProperties();
	const storedId = getSetting(context.db, INSTALL_ID_SETTING);
	const distinctId = storedId ?? uuidv7();
	if (!storedId) setSetting(context.db, INSTALL_ID_SETTING, distinctId);

	let sessionId = uuidv7();
	let lastActivityAt = now();
	const currentSession = (): string => {
		const at = now();
		if (at - lastActivityAt > SESSION_IDLE_MS) sessionId = uuidv7();
		lastActivityAt = at;
		return sessionId;
	};

	const capture = (event: string, properties: Readonly<Record<string, unknown>>): void => {
		if (!usageDataShared(getSetting(context.db, USAGE_DATA_SETTING))) return;
		sink.capture({
			distinctId,
			event,
			properties: {
				...system,
				$app_version: context.appVersion,
				packaged: !context.isDev,
				...properties,
				$session_id: currentSession(),
			},
		});
	};

	const stopCommands = context.commands.observe((outcome) => {
		const usage = commandUsage(
			outcome.command,
			outcome.args,
			outcome.ok
				? { durationMs: outcome.durationMs }
				: { durationMs: outcome.durationMs, failure: outcome.failure },
		);
		for (const { event, properties } of usage) capture(event, properties);
	});

	const runs = new RunUsage({ now, sessionModel: (id) => deps.sessionModel(id) });
	const stopRuns = context.events.subscribe(CHAT_AGENT_EVENT_CHANNEL, (envelope) => {
		if (envelope.ephemeral) return;
		const usage = runs.observe(envelope);
		if (usage) capture(usage.event, usage.properties);
	});

	deps.host.onWindowCreated((window) => watchScreens(window, capture));

	capture('app.launched', {
		first_launch: !storedId,
		$set: { ...system, app_version: context.appVersion },
		$set_once: { first_app_version: context.appVersion },
	});

	return {
		shutdown: async () => {
			stopCommands();
			stopRuns();
			await sink.shutdown(SHUTDOWN_FLUSH_MS);
		},
	};
}

function watchScreens(
	window: BrowserWindow,
	capture: (event: string, properties: UsageProperties) => void,
): void {
	let current: string | undefined;
	const visit = (url: string): void => {
		const screen = screenOf(URL.parse(url)?.hash ?? '');
		if (!screen || screen === current) return;
		current = screen;
		capture('$screen', { $screen_name: screen });
	};
	window.webContents.on('did-navigate', (_event, url) => visit(url));
	window.webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
		if (isMainFrame) visit(url);
	});
}

function postHogSink(): UsageSink | null {
	const key = import.meta.env.MAIN_VITE_POSTHOG_KEY;
	if (!key) return null;
	if (process.env['MALINI_USAGE_DATA'] === 'off') return null;
	if (['1', 'true'].includes(process.env['DO_NOT_TRACK'] ?? '')) return null;
	const host = import.meta.env.MAIN_VITE_POSTHOG_HOST;
	return new PostHog(key, {
		...(host ? { host } : {}),
		disableGeoip: false,
		flushAt: 20,
		flushInterval: 10_000,
	});
}

function systemProperties(): UsageProperties {
	return {
		$os: OS_NAMES[process.platform] ?? process.platform,
		$os_version: process.getSystemVersion(),
		$locale: app.getLocale(),
		arch: process.arch,
		electron_version: process.versions.electron,
	};
}
