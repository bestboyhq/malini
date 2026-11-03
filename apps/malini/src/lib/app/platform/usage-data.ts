import { app, net } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import {
	APP_STARTED_CHANNEL,
	CHAT_AGENT_EVENT_CHANNEL,
	STATS_PROFILE_PUBLISHED_CHANNEL,
} from '$contract/events';
import type { UsageReport } from '$contract/system';
import type { MainContext } from '$main/context';
import { nodeProcessHooks, type MainProcessHooks } from '$main/diagnostics/capture';
import { commandFailureLevel } from '$main/diagnostics/main-diagnostics';
import { thrownDetail } from '$main/diagnostics/thrown';
import { currentEnvironment } from '$main/process/environment';
import type { UsageAccount } from '$lib/stats/stats.platform';
import { HEARD_ABOUT_SETTING, heardAbout, heardAboutProps } from '../domain/heard-about';
import { USAGE_DATA_SETTING, usageDataSetting, usageDataShared } from '../domain/usage-data';
import { reportDay } from '../domain/usage-report';
import { getSetting, setSetting } from './settings.repository';
import { readUsageReport } from './usage-report';

export type UsageActivity = 'app_active' | 'run_finished' | 'profile_published' | 'stats_off';

export interface UsageSink {
	activity(
		name: UsageActivity,
		props: Readonly<Record<string, string>>,
		userId: string | null,
	): void;
	report(report: UsageReport, userId: string | null): void;
	error(message: string): void;
	shutdown(timeoutMs: number): Promise<void>;
}

export interface UsageData {
	share(shared: boolean): void;
	shutdown(): Promise<void>;
}

export interface UsageDataDeps {
	readonly sink?: UsageSink | null;
	readonly account?: () => Promise<UsageAccount>;
	readonly hooks?: Pick<MainProcessHooks, 'onUncaughtException' | 'onUnhandledRejection'>;
	readonly processGone?: (
		listener: (process: string, reason: string, exitCode: number) => void,
	) => void;
	readonly system?: string;
	readonly now?: () => Date;
}

type ErrorShape = Readonly<{ name: string; code: string | null; kind: string | null }>;

const LOGDASH_API = 'https://api.logdash.io';
const LOGDASH_ORIGIN = 'https://app.malini';
const SHUTDOWN_FLUSH_MS = 2000;
const REPORTED_DAY_SETTING = 'usage-data.reported-day';
const REPORT_CHECK_MS = 60 * 60_000;
const ANONYMOUS: UsageAccount = { state: 'anonymous' };

export function startUsageData(context: MainContext, deps: UsageDataDeps = {}): UsageData {
	const sink = deps.sink === undefined ? logdashSink(context.appVersion) : deps.sink;
	const shared = (): boolean => usageDataShared(getSetting(context.db, USAGE_DATA_SETTING));
	const share = (next: boolean): void => {
		const was = shared();
		setSetting(context.db, USAGE_DATA_SETTING, usageDataSetting(next));
		if (sink && was && !next) sink.activity('stats_off', {}, null);
	};
	if (!sink) return { share, shutdown: () => Promise.resolve() };
	const account = deps.account ?? ((): Promise<UsageAccount> => Promise.resolve(ANONYMOUS));
	const send = async (deliver: (userId: string | null) => void): Promise<void> => {
		if (!shared()) return;
		const counted = await account();
		if (counted.state === 'old-terms' || !shared()) return;
		deliver(counted.state === 'accepted' ? counted.userId : null);
	};
	const count = (name: UsageActivity): void => {
		const props = heardAboutProps(heardAbout(getSetting(context.db, HEARD_ABOUT_SETTING)));
		void send((userId) => sink.activity(name, props, userId));
	};
	const system =
		deps.system ??
		`malini ${context.appVersion} · macOS ${process.getSystemVersion()} ${process.arch}`;
	// ponytail: each distinct error is logged once per launch; add a count when frequency matters.
	const reported = new Set<string>();
	const report = (what: string): void => {
		if (!shared() || reported.has(what)) return;
		reported.add(what);
		void send(() => sink.error(`${what} · ${system}`));
	};

	const stopFailures = context.commands.observeFailures((failed) => {
		if (commandFailureLevel(failed.failure) === 'error')
			report(`${failed.command} failed: ${described(failed.failure)}`);
	});
	const hooks = deps.hooks ?? nodeProcessHooks();
	const stopExceptions = hooks.onUncaughtException((error) =>
		report(`uncaught exception: ${described(thrownDetail(error))}`),
	);
	const stopRejections = hooks.onUnhandledRejection((reason) =>
		report(`unhandled rejection: ${described(thrownDetail(reason))}`),
	);
	(deps.processGone ?? electronProcessGone)((kind, reason, exitCode) =>
		report(`${kind} process gone: ${reason}, exit ${exitCode}`),
	);

	const stopRuns = context.events.subscribe(CHAT_AGENT_EVENT_CHANNEL, (envelope) => {
		const type = envelope.event.type;
		if (!envelope.ephemeral && (type === 'run.completed' || type === 'run.failed'))
			count('run_finished');
	});
	const stopPublished = context.events.subscribe(STATS_PROFILE_PUBLISHED_CHANNEL, () =>
		count('profile_published'),
	);

	count('app_active');

	const now = deps.now ?? ((): Date => new Date());
	const reportYesterday = (): void => {
		const at = now();
		const day = reportDay(at);
		if (!shared() || getSetting(context.db, REPORTED_DAY_SETTING) === day) return;
		setSetting(context.db, REPORTED_DAY_SETTING, day);
		const report = readUsageReport(context.db, at);
		if (report) void send((userId) => sink.report(report, userId));
	};
	const stopStarted = context.events.subscribe(APP_STARTED_CHANNEL, reportYesterday);
	const reportTimer = setInterval(reportYesterday, REPORT_CHECK_MS);
	reportTimer.unref();

	return {
		share,
		shutdown: async () => {
			clearInterval(reportTimer);
			stopStarted();
			stopFailures();
			stopExceptions();
			stopRejections();
			stopRuns();
			stopPublished();
			await sink.shutdown(SHUTDOWN_FLUSH_MS);
		},
	};
}

function described(error: ErrorShape): string {
	return [error.name, error.code, error.kind && `(${error.kind})`].filter(Boolean).join(' ');
}

function electronProcessGone(
	listener: (process: string, reason: string, exitCode: number) => void,
): void {
	app.on('render-process-gone', (_event, _contents, details) => {
		if (details.reason !== 'clean-exit') listener('renderer', details.reason, details.exitCode);
	});
	app.on('child-process-gone', (_event, details) => {
		if (details.reason !== 'clean-exit') listener(details.type, details.reason, details.exitCode);
	});
}

export function logdashUserId(site: string, account: string): string {
	return createHash('sha256').update(`${site}:${account}`).digest('hex');
}

function logdashSink(appVersion: string): UsageSink | null {
	if (process.env['MALINI_USAGE_DATA'] === 'off') return null;
	if (currentEnvironment().doNotTrack) return null;
	const site = import.meta.env.MAIN_VITE_LOGDASH_SITE;
	const key = import.meta.env.MAIN_VITE_LOGDASH_API_KEY;
	if (!site && !key) return null;
	const pending = new Set<Promise<unknown>>();
	const post = (path: string, headers: Readonly<Record<string, string>>, body: unknown): void => {
		const sent = net
			.fetch(`${LOGDASH_API}${path}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...headers },
				body: JSON.stringify(body),
			})
			.catch(() => undefined)
			.finally(() => pending.delete(sent));
		pending.add(sent);
	};
	const webEvent = (
		name: string,
		props: Readonly<Record<string, string | number>>,
		userId: string | null,
	): void => {
		if (!site) return;
		const at = new Date().toISOString();
		const event = {
			id: randomUUID(),
			timestamp: at,
			name: `malini_desktop_${name}`,
			path: '/',
			...(userId ? { userId: logdashUserId(site, userId) } : {}),
		};
		post(
			'/web_events',
			{ Origin: LOGDASH_ORIGIN },
			{
				siteId: site,
				sentAt: at,
				events: [Object.keys(props).length > 0 ? { ...event, props } : event],
			},
		);
	};
	return {
		activity: (name, props, userId) => webEvent(name, props, userId),
		report: (report, userId) => webEvent('loop', reportProps(report), userId),
		error: (message) => {
			if (!key) return;
			post(
				'/logs',
				{ 'project-api-key': key },
				{
					createdAt: new Date().toISOString(),
					level: 'error',
					message,
					namespace: `malini@${appVersion}`,
				},
			);
		},
		shutdown: async (timeoutMs) => {
			await Promise.race([
				Promise.allSettled(pending),
				new Promise((resolve) => setTimeout(resolve, timeoutMs)),
			]);
		},
	};
}

function reportProps(report: UsageReport): Readonly<Record<string, string | number>> {
	return {
		started: report.started,
		prompts: report.prompts,
		merged: report.merged,
		archived: report.archived,
		...(report.turns === null ? {} : { turns: report.turns }),
		...(report.minutes === null ? {} : { minutes: report.minutes }),
		age: report.age,
	};
}
