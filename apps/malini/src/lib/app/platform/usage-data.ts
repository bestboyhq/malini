import { app, net } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import {
	APP_STARTED_CHANNEL,
	CHAT_AGENT_EVENT_CHANNEL,
	PULL_REQUESTS_SHIP_CHANGED_CHANNEL,
	REPOSITORIES_CHANGED_CHANNEL,
	REPOSITORIES_WORKSTREAM_CREATED_CHANNEL,
	STATS_PROFILE_PUBLISHED_CHANNEL,
} from '$contract/events';
import type { UsageReport } from '$contract/system';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { nodeProcessHooks, type MainProcessHooks } from '$main/diagnostics/capture';
import { commandFailureLevel } from '$main/diagnostics/main-diagnostics';
import { thrownDetail } from '$main/diagnostics/thrown';
import { currentEnvironment } from '$main/process/environment';
import { localDate, shiftDate, type UsageAccount } from '$lib/stats/stats.platform';
import { listProjects, listRepositoryCatalog } from '$shared/repositories/repositories.platform';
import { HEARD_ABOUT_SETTING, heardAbout, heardAboutProps } from '../domain/heard-about';
import { ONBOARDING_FINISHED_SETTING, type OnboardingStep } from '../domain/onboarding';
import { USAGE_DATA_SETTING, usageDataSetting, usageDataShared } from '../domain/usage-data';
import { reportAge, reportDay } from '../domain/usage-report';
import { getSetting, setSetting } from './settings.repository';
import { hasPromptRun, readUsageReport, userWorkstreams } from './usage-report';
import { createToolTracker, type ToolActivity, type ToolEvent } from './usage-tools';

export type UsageJourney =
	| 'first_open'
	| 'setup_tools'
	| 'setup_sounds'
	| 'setup_sidebar'
	| 'setup_defaults'
	| 'setup_heard_about'
	| 'setup_finished'
	| 'first_repository'
	| 'first_workstream'
	| 'first_prompt'
	| 'first_merge'
	| 'first_profile_published'
	| 'returned_week_1'
	| 'returned_month_1';

export type UsageJourneyMarker = Exclude<
	UsageJourney,
	'first_open' | 'returned_week_1' | 'returned_month_1'
>;

export type UsageActivity =
	| UsageJourney
	| 'app_active'
	| 'run_finished'
	| 'profile_published'
	| 'stats_off'
	| 'day'
	| 'month'
	| ToolActivity;

export interface UsageSink {
	activity(
		name: UsageActivity,
		props: Readonly<Record<string, string | number>>,
		userId: string | null,
	): Promise<boolean>;
	report(report: UsageReport, userId: string | null): Promise<boolean>;
	error(message: string): Promise<boolean>;
	shutdown(timeoutMs: number): Promise<void>;
}

export interface UsageData {
	share(shared: boolean): void;
	journey(marker: UsageJourneyMarker, details?: Readonly<Record<string, string | number>>): void;
	shutdown(): Promise<void>;
}

const SETUP_STEP_MARKERS: Readonly<Record<OnboardingStep, UsageJourneyMarker>> = {
	tools: 'setup_tools',
	sounds: 'setup_sounds',
	sidebar: 'setup_sidebar',
	defaults: 'setup_defaults',
	'heard-about': 'setup_heard_about',
};

export function setupStepMarker(step: OnboardingStep): UsageJourneyMarker {
	return SETUP_STEP_MARKERS[step];
}

export interface UsageDataDeps {
	readonly sink?: UsageSink | null;
	readonly account?: () => Promise<UsageAccount>;
	readonly published?: () => boolean;
	readonly hooks?: Pick<MainProcessHooks, 'onUncaughtException' | 'onUnhandledRejection'>;
	readonly processGone?: (
		listener: (process: string, reason: string, exitCode: number) => void,
	) => void;
	readonly system?: string;
	readonly now?: () => Date;
	readonly freshInstall?: boolean;
}

type ErrorShape = Readonly<{ name: string; code: string | null; kind: string | null }>;

const LOGDASH_API = 'https://api.logdash.io';
const LOGDASH_ORIGIN = 'https://app.malini';
const SHUTDOWN_FLUSH_MS = 2000;
const REPORTED_DAY_SETTING = 'usage-data.reported-day';
const FIRST_OPEN_SETTING = 'usage-data.first-open';
const JOURNEY_SETTING = 'usage-data.journey';
const LAST_ACTIVE_DAY_SETTING = 'usage-data.last-active-day';
const ACTIVE_DAYS_SETTING = 'usage-data.active-days';
const REPORTED_MONTH_SETTING = 'usage-data.reported-month';
const SETUP_STARTED_SETTING = 'usage-data.setup-started';
const REPORT_CHECK_MS = 60 * 60_000;
const DAY_MS = 86_400_000;
const ANONYMOUS: UsageAccount = { state: 'anonymous' };

export function startUsageData(context: MainContext, deps: UsageDataDeps = {}): UsageData {
	const now = deps.now ?? ((): Date => new Date());
	const sink = deps.sink === undefined ? logdashSink(context.appVersion) : deps.sink;
	const shared = (): boolean => usageDataShared(getSetting(context.db, USAGE_DATA_SETTING));
	const setShare = (next: boolean): void => {
		setSetting(context.db, USAGE_DATA_SETTING, usageDataSetting(next));
	};
	if (!sink)
		return { share: setShare, journey: () => undefined, shutdown: () => Promise.resolve() };
	const storedFirstOpen = getSetting(context.db, FIRST_OPEN_SETTING);
	if (storedFirstOpen === null && deps.freshInstall === true)
		setSetting(context.db, FIRST_OPEN_SETTING, localDate(now()));
	const firstOpen = getSetting(context.db, FIRST_OPEN_SETTING);
	const rememberActiveDay = (): void => {
		const today = localDate(now());
		const days = stringList(getSetting(context.db, ACTIVE_DAYS_SETTING));
		if (days.includes(today)) return;
		setSetting(context.db, ACTIVE_DAYS_SETTING, JSON.stringify([...days, today].sort()));
	};
	rememberActiveDay();
	const account = deps.account ?? ((): Promise<UsageAccount> => Promise.resolve(ANONYMOUS));
	const send = async (deliver: (userId: string | null) => Promise<boolean>): Promise<boolean> => {
		if (!shared()) return false;
		const counted = await account();
		if (counted.state === 'old-terms' || !shared()) return false;
		return deliver(counted.state === 'accepted' ? counted.userId : null);
	};
	const sending = new Map<string, Promise<void>>();
	const sendOnce = (
		key: string,
		sent: () => boolean,
		deliver: (userId: string | null) => Promise<boolean>,
		record: () => void,
	): void => {
		if (sent()) return;
		const attempt = async (): Promise<void> => {
			if (!sent() && (await send(deliver))) record();
		};
		const previous = sending.get(key);
		const next = (async () => {
			if (previous) await previous.catch(() => undefined);
			await attempt();
		})().finally(() => {
			if (sending.get(key) === next) sending.delete(key);
		});
		sending.set(key, next);
	};
	const count = (
		name: UsageActivity,
		extra: Readonly<Record<string, string | number>> = {},
	): void => {
		const props = {
			...heardAboutProps(heardAbout(getSetting(context.db, HEARD_ABOUT_SETTING))),
			...extra,
		};
		void send((userId) => sink.activity(name, props, userId));
	};
	const setupSeconds = (marker: UsageJourney): Readonly<Record<string, number>> => {
		if (!marker.startsWith('setup_')) return {};
		if (marker === 'setup_tools' && getSetting(context.db, SETUP_STARTED_SETTING) === null)
			setSetting(context.db, SETUP_STARTED_SETTING, now().toISOString());
		const started = Date.parse(getSetting(context.db, SETUP_STARTED_SETTING) ?? '');
		const finished =
			marker === 'setup_finished' ? getSetting(context.db, ONBOARDING_FINISHED_SETTING) : null;
		const end = finished === null ? now().getTime() : Date.parse(finished);
		return Number.isNaN(started) || Number.isNaN(end)
			? {}
			: { setup_seconds: Math.max(0, Math.round((end - started) / 1000)) };
	};
	const journeySent = (): string[] => stringList(getSetting(context.db, JOURNEY_SETTING));
	const sendJourney = (
		marker: UsageJourney,
		extra: Readonly<Record<string, string | number>> = {},
	): void => {
		const cohort = firstOpen;
		if (cohort === null || journeySent().includes(marker)) return;
		const timing = setupSeconds(marker);
		sendOnce(
			marker,
			() => journeySent().includes(marker),
			(userId) =>
				sink.activity(
					marker,
					{ cohort, days: daysBetween(cohort, localDate(now())), ...timing, ...extra },
					userId,
				),
			() => setSetting(context.db, JOURNEY_SETTING, JSON.stringify([...journeySent(), marker])),
		);
	};
	const sendMonth = (): void => {
		const today = localDate(now());
		const current = monthOf(today);
		const earlier = stringList(getSetting(context.db, ACTIVE_DAYS_SETTING)).filter(
			(day) => monthOf(day) < current,
		);
		const last = earlier.sort().at(-1);
		if (last === undefined) return;
		const month = monthOf(last);
		const activeDays = new Set(earlier.filter((day) => monthOf(day) === month)).size;
		sendOnce(
			`month:${month}`,
			() => getSetting(context.db, REPORTED_MONTH_SETTING) === month,
			(userId) => sink.activity('month', { month, active_days: activeDays }, userId),
			() => {
				setSetting(context.db, REPORTED_MONTH_SETTING, month);
				setSetting(
					context.db,
					ACTIVE_DAYS_SETTING,
					JSON.stringify(
						stringList(getSetting(context.db, ACTIVE_DAYS_SETTING)).filter(
							(day) => monthOf(day) >= current,
						),
					),
				);
			},
		);
	};
	const sendDay = (): void => {
		const today = localDate(now());
		const previous = getSetting(context.db, LAST_ACTIVE_DAY_SETTING);
		const base = firstOpen ?? earliestActivity(context.db);
		const props = {
			week_first: previous === null || weekStart(previous) !== weekStart(today) ? 'yes' : 'no',
			month_first: previous === null || monthOf(previous) !== monthOf(today) ? 'yes' : 'no',
			age: base === null ? 'later' : reportAge(Date.parse(today) - Date.parse(base)),
		};
		sendOnce(
			`day:${today}`,
			() => getSetting(context.db, LAST_ACTIVE_DAY_SETTING) === today,
			(userId) => sink.activity('day', props, userId),
			() => setSetting(context.db, LAST_ACTIVE_DAY_SETTING, today),
		);
	};
	const launch = (): void => {
		if (firstOpen !== null) {
			sendJourney('first_open');
			const days = daysBetween(firstOpen, localDate(now()));
			if (days >= 1 && days <= 7) sendJourney('returned_week_1');
			if (days >= 8 && days <= 30) sendJourney('returned_month_1');
		}
		if (getSetting(context.db, ONBOARDING_FINISHED_SETTING) !== null) sendJourney('setup_finished');
		sendMonth();
		sendDay();
		void firstRepository();
		if (hasPromptRun(context.db, now())) sendJourney('first_prompt');
		if (firstOpen === null) return;
		const workstreams = userWorkstreams(context.db);
		if (workstreams.length > 0) sendJourney('first_workstream');
		if (workstreams.some(({ merged }) => merged)) sendJourney('first_merge');
		if (deps.published?.() === true) sendJourney('first_profile_published');
	};
	const share = (next: boolean): void => {
		const was = shared();
		setSetting(context.db, USAGE_DATA_SETTING, usageDataSetting(next));
		if (next && !was) launch();
		if (was && !next) void sink.activity('stats_off', {}, null);
	};
	const firstRepository = async (): Promise<void> => {
		if (firstOpen === null || journeySent().includes('first_repository')) return;
		try {
			const repositories = await listRepositoryCatalog(context.db);
			if (repositories.length > 0) sendJourney('first_repository');
		} catch {
			return;
		}
	};
	const system =
		deps.system ??
		`malini ${context.appVersion} · macOS ${process.getSystemVersion()} ${process.arch}`;
	// ponytail: each distinct error is logged once per launch; add a count when frequency matters.
	const reported = new Set<string>();
	const report = (what: string): void => {
		if (!shared() || reported.has(what)) return;
		reported.add(what);
		void (async () => {
			if (!(await send(() => sink.error(`${what} · ${system}`)))) reported.delete(what);
		})();
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
		if (envelope.ephemeral || (type !== 'run.completed' && type !== 'run.failed')) return;
		count('run_finished');
		if (hasPromptRun(context.db, now())) sendJourney('first_prompt');
	});
	const stopPublished = context.events.subscribe(STATS_PROFILE_PUBLISHED_CHANNEL, () => {
		count('profile_published');
		sendJourney('first_profile_published');
	});
	const stopRepositories = context.events.subscribe(REPOSITORIES_CHANGED_CHANNEL, () => {
		void firstRepository();
	});
	const stopWorkstreams = context.events.subscribe(REPOSITORIES_WORKSTREAM_CREATED_CHANNEL, () =>
		sendJourney('first_workstream'),
	);
	const stopShips = context.events.subscribe(PULL_REQUESTS_SHIP_CHANGED_CHANNEL, (changed) => {
		if (changed.merged) sendJourney('first_merge');
	});
	const tools = createToolTracker();
	const countTool = (event: ToolEvent | null): void => {
		if (event === null) return;
		const phase = getSetting(context.db, ONBOARDING_FINISHED_SETTING) === null ? 'setup' : 'later';
		count(event.name, { ...event.props, phase });
	};
	const stopToolStarts = context.commands.observeStarts((started) =>
		countTool(tools.begin(started)),
	);
	const stopTools = context.commands.observe((outcome) => countTool(tools.end(outcome)));

	count('app_active');
	launch();

	const reportYesterday = (): void => {
		const at = now();
		const day = reportDay(at);
		const reported = (): boolean => getSetting(context.db, REPORTED_DAY_SETTING) === day;
		if (!shared() || reported()) return;
		const record = (): void => setSetting(context.db, REPORTED_DAY_SETTING, day);
		const report = readUsageReport(context.db, at);
		if (!report) return record();
		sendOnce(`loop:${day}`, reported, (userId) => sink.report(report, userId), record);
	};
	const stopStarted = context.events.subscribe(APP_STARTED_CHANNEL, reportYesterday);
	const reportTimer = setInterval(reportYesterday, REPORT_CHECK_MS);
	reportTimer.unref();

	return {
		share,
		journey: (marker, details) => sendJourney(marker, details),
		shutdown: async () => {
			clearInterval(reportTimer);
			stopStarted();
			stopFailures();
			stopExceptions();
			stopRejections();
			stopRuns();
			stopPublished();
			stopRepositories();
			stopWorkstreams();
			stopShips();
			stopToolStarts();
			stopTools();
			await sink.shutdown(SHUTDOWN_FLUSH_MS);
		},
	};
}

function stringList(raw: string | null): string[] {
	if (raw === null) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter((item): item is string => typeof item === 'string')
			: [];
	} catch {
		return [];
	}
}

function monthOf(date: string): string {
	return date.slice(0, 7);
}

function weekStart(date: string): string {
	const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
	return shiftDate(date, -((weekday + 6) % 7));
}

function daysBetween(from: string, to: string): number {
	return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

function earliestActivity(db: MaliniDatabase): string | null {
	const days = listProjects(db)
		.map((project) => localDate(new Date(project.createdAt)))
		.sort();
	return days[0] ?? null;
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
	const post = (
		path: string,
		headers: Readonly<Record<string, string>>,
		body: unknown,
	): Promise<boolean> => {
		const deliver = async (): Promise<boolean> => {
			try {
				const response = await net.fetch(`${LOGDASH_API}${path}`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', ...headers },
					body: JSON.stringify(body),
				});
				return response.ok;
			} catch {
				return false;
			}
		};
		const sent = deliver().finally(() => pending.delete(sent));
		pending.add(sent);
		return sent;
	};
	const webEvent = (
		name: string,
		props: Readonly<Record<string, string | number>>,
		userId: string | null,
	): Promise<boolean> => {
		if (!site) return Promise.resolve(false);
		const at = new Date().toISOString();
		const event = {
			id: randomUUID(),
			timestamp: at,
			name: `malini_desktop_${name}`,
			path: '/',
			...(userId ? { userId: logdashUserId(site, userId) } : {}),
		};
		return post(
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
			if (!key) return Promise.resolve(false);
			return post(
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
