import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { APP_DATA_ROOT } from '@malini/agent-bridge/sandbox';
import {
	CHAT_SESSION_RENAMED_CHANNEL,
	CHAT_TURN_FINISHED_CHANNEL,
	REPOSITORIES_WORKSTREAM_RENAMED_CHANNEL,
	type SessionRenamedPayload,
	type WorkstreamRenamedPayload,
} from '$contract/events';
import {
	CONTEXT_WINDOW_SETTING,
	OPTIMIZE_CONTEXT_SETTING,
	STE_REPLIES_SETTING,
	contextWindowOf,
	optimizesContext,
	writesSte,
} from '$contract/agent';
import type { BrowserTabArgs } from '$contract/browser';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { automationBoundaryForSession } from '$lib/automations/automations.platform';
import type { SecretsPlatform } from '$lib/secrets/secrets.platform';
import {
	listWorkstreams,
	workstreamRepositoryName,
} from '$shared/repositories/repositories.platform';
import { IdSequence } from '../id-sequence';
import { listOpenRuns } from '../runs.repository';
import { agentBoundary, appDataEntries } from './boundary';
import type { AgentRunLeases } from './lifecycle';
import {
	PromptsInFlight,
	continuePausedRun,
	continuePausedRuns,
	defineBridgeCommands,
	type BridgeCommandDeps,
	type SendPromptHooks,
} from './commands';
import { reapOrphansOnExit, reapOrphansOnStartup } from './lifecycle';
import { createElectronNodeProcessFactory, type BridgeProcessFactory } from './process';
import { recordDeniedMaliniCall } from './malini-approvals.service';
import { ChatDeliveries } from '../deliveries.service';
import { ChatNamer } from './naming';
import { answerPlatformRequest } from './platform-tools';
import {
	browserResultCommand,
	historyResultCommand,
	platformResultCommand,
	type BridgeAgentRequest,
	type BridgeBrowserRequest,
	type BridgeCommand,
	type BrowserAnswer,
	type HistoryAnswer,
} from './protocol';
import { BridgeRuntime, type BridgeRuntimeHooks } from './runtime';
import {
	conversationRecord,
	persistedBridgeSession,
	worktreePath,
	type ResolveProviderEnvironment,
} from './sessions';
import type { BridgeHealth, BridgeSupervisor } from './supervisor';

const PAUSE_BUDGET_MS = 5_000;
const RESIZE_ROUNDING_PX = 1;

export interface BrowserPageInfo {
	readonly url: string;
	readonly title: string;
}

export interface BrowserConsoleLine {
	readonly level: 'debug' | 'info' | 'warning' | 'error';
	readonly text: string;
	readonly source: string;
}

export interface BrowserAutomation {
	open(tab: BrowserTabArgs, url: string): Promise<BrowserPageInfo>;
	readPage(tab: BrowserTabArgs): Promise<string>;
	screenshot(
		tab: BrowserTabArgs,
		worktree: string,
		part: { readonly selector?: string; readonly fullPage: boolean },
	): Promise<{
		readonly path: string;
		readonly previewPath: string;
		readonly url: string;
		readonly pageHeight?: number;
	}>;
	click(tab: BrowserTabArgs, selector: string): Promise<BrowserPageInfo>;
	hover(tab: BrowserTabArgs, selector: string): Promise<BrowserPageInfo>;
	type(
		tab: BrowserTabArgs,
		selector: string,
		text: string,
		submit: boolean,
	): Promise<BrowserPageInfo>;
	press(tab: BrowserTabArgs, key: string): Promise<BrowserPageInfo>;
	scroll(
		tab: BrowserTabArgs,
		by: { readonly x: number; readonly y: number; readonly selector?: string },
	): Promise<{
		readonly x: number;
		readonly y: number;
		readonly height: number;
		readonly container?: string;
	}>;
	wait(
		tab: BrowserTabArgs,
		until: {
			readonly seconds: number;
			readonly gone: boolean;
			readonly text?: string;
			readonly selector?: string;
		},
	): Promise<BrowserPageInfo>;
	evaluate(tab: BrowserTabArgs, script: string): Promise<string>;
	consoleLines(tab: BrowserTabArgs): Promise<{
		readonly url: string;
		readonly lines: readonly BrowserConsoleLine[];
		readonly dropped: number;
	}>;
	goBack(tab: BrowserTabArgs): Promise<BrowserPageInfo>;
	goForward(tab: BrowserTabArgs): Promise<BrowserPageInfo>;
	reload(tab: BrowserTabArgs): Promise<BrowserPageInfo>;
	resize(
		tab: BrowserTabArgs,
		width: number,
		height?: number,
	): Promise<{ readonly width: number; readonly height: number }>;
	close(tab: BrowserTabArgs): Promise<boolean>;
}

export interface AgentServiceDeps {
	readonly processFactory?: BridgeProcessFactory;
	readonly spawnEnvironment: () => Readonly<Record<string, string>>;
	readonly leases: AgentRunLeases;
	readonly providerEnvironment?: ResolveProviderEnvironment;
	readonly bridgeScriptPath?: string;
	readonly readyTimeoutMs?: number;
	readonly verifyAttachment?: SendPromptHooks['verifyAttachment'];
	readonly collectAttachmentGarbage?: SendPromptHooks['collectAttachmentGarbage'];
	readonly prepareAttachments?: SendPromptHooks['prepareAttachments'];
	readonly theme?: SendPromptHooks['theme'];
	readonly shippingFailure?: SendPromptHooks['shippingFailure'];
	readonly shellRuns?: SendPromptHooks['shellRuns'];
	readonly plugins?: SendPromptHooks['plugins'];
	readonly hooks: BridgeRuntimeHooks & Pick<SendPromptHooks, 'captureCheckpoint'>;
	readonly browser?: BrowserAutomation;
	readonly deliveries?: ChatDeliveries;
	readonly secrets?: SecretsPlatform;
	readonly log?: (line: string) => void;
}

export interface BrowserRequestDeps {
	readonly db: MaliniDatabase;
	readonly checkoutsRoot: string;
	readonly browser: BrowserAutomation | undefined;
}

export async function answerBrowserRequest(
	request: BridgeBrowserRequest,
	deps: BrowserRequestDeps,
): Promise<BrowserAnswer> {
	try {
		const { browser } = deps;
		if (!browser) return { ok: false, error: 'The Malini browser is not available.' };
		const session = persistedBridgeSession(deps.db, request.sessionId);
		if (!session) return { ok: false, error: `Agent session \`${request.sessionId}\` is unknown.` };
		const boundary = automationBoundaryForSession(deps.db, request.sessionId);
		if (boundary && !boundary.internet) {
			return {
				ok: false,
				error:
					'This automation runs with its internet off, so Malini does not open its browser. Ask the user to turn the internet on for this automation on its page in Automations.',
			};
		}
		const { workstreamId } = session;
		const tab = { workstreamId, tabId: agentBrowserTabId(request.sessionId) };
		switch (request.action) {
			case 'open': {
				const page = await browser.open(tab, request.url);
				return {
					ok: true,
					text: `Opened ${describePage(page)}. Call browser_screenshot to see it.`,
				};
			}
			case 'snapshot':
				return { ok: true, text: await browser.readPage(tab) };
			case 'screenshot': {
				const worktree = worktreePath(deps.checkoutsRoot, workstreamId);
				const { fullPage, selector } = request;
				const part = selector === undefined ? { fullPage } : { fullPage, selector };
				const shot = await browser.screenshot(tab, worktree, part);
				const cut =
					shot.pageHeight === undefined
						? ''
						: ` The page is ${shot.pageHeight}px tall, more than one screenshot holds, so it shows the top part. Pass the selector of an element further down for the rest.`;
				return {
					ok: true,
					text: `Screenshot of ${shot.url} saved to ${shot.path}.${cut} Embed it in your report as ![what it shows](${shot.path}).`,
					imagePath: shot.previewPath,
				};
			}
			case 'click': {
				const page = await browser.click(tab, request.selector);
				return {
					ok: true,
					text: `Clicked \`${request.selector}\`. The page is now ${describePage(page)}.`,
				};
			}
			case 'hover': {
				const page = await browser.hover(tab, request.selector);
				return {
					ok: true,
					text: `The mouse is over \`${request.selector}\`. The page is now ${describePage(page)}.`,
				};
			}
			case 'type': {
				const { selector, text, submit } = request;
				const page = await browser.type(tab, selector, text, submit);
				const enter = submit ? ' and pressed Enter' : '';
				return {
					ok: true,
					text: `Typed into \`${selector}\`${enter}. The page is now ${describePage(page)}.`,
				};
			}
			case 'press': {
				const page = await browser.press(tab, request.key);
				return {
					ok: true,
					text: `Pressed ${request.key}. The page is now ${describePage(page)}.`,
				};
			}
			case 'scroll': {
				const { x, y, selector } = request;
				const by = selector === undefined ? { x, y } : { x, y, selector };
				const { height, container, ...at } = await browser.scroll(tab, by);
				const what = container === undefined ? 'The page' : container;
				return { ok: true, text: `${what} is scrolled to x ${at.x}, y ${at.y} of ${height}px.` };
			}
			case 'wait': {
				const { seconds, gone, text, selector } = request;
				const page = await browser.wait(tab, {
					seconds,
					gone,
					...(text === undefined ? {} : { text }),
					...(selector === undefined ? {} : { selector }),
				});
				return { ok: true, text: `${describeWait(request)} The page is ${describePage(page)}.` };
			}
			case 'evaluate':
				return { ok: true, text: await browser.evaluate(tab, request.script) };
			case 'console':
				return { ok: true, text: describeConsole(await browser.consoleLines(tab)) };
			case 'back':
				return {
					ok: true,
					text: `Went back to ${describePage(await browser.goBack(tab))}.`,
				};
			case 'forward': {
				const page = await browser.goForward(tab);
				return { ok: true, text: `Went forward to ${describePage(page)}.` };
			}
			case 'reload':
				return { ok: true, text: `Reloaded ${describePage(await browser.reload(tab))}.` };
			case 'resize': {
				const size = await browser.resize(tab, request.width, request.height);
				return { ok: true, text: describeSize(request, size) };
			}
			case 'close':
				return {
					ok: true,
					text: (await browser.close(tab))
						? 'Closed your browser tab and its page.'
						: 'You had no browser tab open, so nothing closed.',
				};
		}
	} catch (error) {
		return { ok: false, error: describe(error) };
	}
}

export function agentBrowserTabId(sessionId: string): string {
	return `chat-${sessionId}`;
}

function describeSize(
	asked: { readonly width: number; readonly height?: number },
	{ width, height }: { readonly width: number; readonly height: number },
): string {
	const wide =
		width < asked.width - RESIZE_ROUNDING_PX
			? `${width}px wide, the widest Malini's window allows while the chat keeps its minimum width`
			: width > asked.width + RESIZE_ROUNDING_PX
				? `${width}px wide, the narrowest the inspector gets in Malini's window`
				: `${width}px wide`;
	if (asked.height === undefined) return `The page is now ${wide}.`;
	if (Math.abs(height - asked.height) <= RESIZE_ROUNDING_PX) {
		return `The page is now ${wide} and ${height}px tall.`;
	}
	return `The page is now ${wide}. It stays ${height}px tall while the user sees the tab.`;
}

function describeWait({
	seconds,
	gone,
	text,
	selector,
}: Extract<BridgeBrowserRequest, { action: 'wait' }>): string {
	if (text === undefined && selector === undefined) return `Waited ${seconds}s.`;
	const what =
		text === undefined
			? `\`${selector ?? ''}\``
			: selector === undefined
				? `"${text}"`
				: `"${text}" in \`${selector}\``;
	return gone ? `${what} is gone.` : `${what} shows.`;
}

function describeConsole({
	url,
	lines,
	dropped,
}: Awaited<ReturnType<BrowserAutomation['consoleLines']>>): string {
	if (lines.length === 0) return `The console of ${url} is empty since it loaded.`;
	const older = dropped > 0 ? `, after ${dropped} older ones Malini no longer keeps` : '';
	const listed = lines.map(
		({ level, text, source }) => `[${level}] ${text}${source ? ` (${source})` : ''}`,
	);
	return [`${lines.length} console messages of ${url} since it loaded${older}:`, ...listed].join(
		'\n',
	);
}

function describePage(page: BrowserPageInfo): string {
	const title = page.title.trim();
	return title.length > 0 && title !== page.url ? `${page.url} ("${title}")` : page.url;
}

export interface AgentService {
	readonly runtime: BridgeRuntime;
	readonly namer: ChatNamer;
	readonly bridgeScriptPath: string;
	readonly started: boolean;
	health(): BridgeHealth;
	ensureReady(): Promise<BridgeSupervisor>;
	stop(): Promise<void>;
	closeOpenRunsForExit(): Promise<number>;
	continuePausedRuns(causeEventId: number | null): Promise<void>;
	continuePausedRun(
		paused: Readonly<{ sessionId: string; runId: string }>,
		causeEventId: number | null,
	): Promise<void>;
	handOutSecrets(repository: string | null): Promise<void>;
}

export function selectBridgeScriptPath(resourcesRoot: string, isDev: boolean): string {
	const bundled = join(resourcesRoot, 'agent-bridge', 'cli.js');
	if (existsSync(bundled)) return bundled;
	if (isDev) {
		let dir = resolve(resourcesRoot);
		for (let depth = 0; depth < 5; depth += 1) {
			const candidate = join(dir, 'packages', 'agent-bridge', 'dist', 'cli.js');
			if (existsSync(candidate)) return candidate;
			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	}
	return bundled;
}

export function missingBridgeScriptMessage(path: string): string {
	return `agent bridge script missing at ${path}; run \`corepack pnpm --filter @malini/agent-bridge build\``;
}

export function bridgePrivateRuntimeRoot(appDataRoot: string): string {
	return join(appDataRoot, 'agent', 'bridge-runtime');
}

export async function startAgentService(
	context: MainContext,
	deps: AgentServiceDeps,
): Promise<AgentService> {
	const log = deps.log ?? ((line: string) => console.error(line));
	const { db } = context;
	const sending = new PromptsInFlight();
	const deliveries = deps.deliveries ?? new ChatDeliveries(context, log);

	try {
		log(`agent: reaped ${reapOrphansOnStartup(db)} orphaned run(s) on startup`);
	} catch (error) {
		log(`agent: startup orphan reap failed (continuing): ${describe(error)}`);
	}

	const bridgeScriptPath =
		deps.bridgeScriptPath ?? selectBridgeScriptPath(context.resourcesRoot, context.isDev);
	const privateRuntimeRoot = bridgePrivateRuntimeRoot(context.appDataRoot);
	try {
		mkdirSync(privateRuntimeRoot, { recursive: true, mode: 0o700 });
	} catch (error) {
		log(`agent: could not create the bridge private runtime root: ${describe(error)}`);
	}

	const runtime = new BridgeRuntime({
		db,
		events: context.events,
		checkoutsRoot: context.checkoutsRoot,
		leases: deps.leases,
		...(deps.providerEnvironment ? { providerEnvironment: deps.providerEnvironment } : {}),
		supervisorConfig: {
			processFactory: deps.processFactory ?? createElectronNodeProcessFactory(),
			spawn: {
				scriptPath: bridgeScriptPath,
				args: ['--stdio'],
				env: {
					...deps.spawnEnvironment(),
					AGENT_BRIDGE_LOG: join(context.appDataRoot, 'agent-bridge.log'),
					MALINI_AGENT_BRIDGE_PRIVATE_RUNTIME_ROOT: privateRuntimeRoot,
					[APP_DATA_ROOT]: context.appDataRoot,
				},
			},
			...(deps.readyTimeoutMs === undefined ? {} : { readyTimeoutMs: deps.readyTimeoutMs }),
			log,
		},
		hooks: {
			...deps.hooks,
			onAgentRequest: (request, supervisor) => void answerOn(supervisor, request),
		},
		log,
	});

	const namer = new ChatNamer(
		db,
		async (task, automation) => {
			const environment =
				(await deps.providerEnvironment?.(automation.provider, automation.model)) ?? {};
			return (await runtime.ensureReady()).suggestTitle(task, automation, environment);
		},
		{
			chat(workstreamId, sessionId, name) {
				const payload: SessionRenamedPayload = { workstreamId, sessionId, name };
				context.events.emit(CHAT_SESSION_RENAMED_CHANNEL, payload);
			},
			workstream(workstreamId, name) {
				const payload: WorkstreamRenamedPayload = { workstreamId, name };
				context.events.emit(REPOSITORIES_WORKSTREAM_RENAMED_CHANNEL, payload);
			},
		},
		log,
	);
	const stopNamingTurns = context.events.subscribe(CHAT_TURN_FINISHED_CHANNEL, (turn) => {
		namer.turnFinished(turn);
	});

	async function answerOn(
		supervisor: BridgeSupervisor,
		request: BridgeAgentRequest,
	): Promise<void> {
		const command = await answerFor(supervisor.nextCommandId(), request);
		try {
			await supervisor.sendCommand(command);
		} catch (error) {
			log(`agent: could not answer ${request.type} \`${request.requestId}\`: ${describe(error)}`);
		}
	}

	async function answerFor(id: string, request: BridgeAgentRequest): Promise<BridgeCommand> {
		switch (request.type) {
			case 'bridge.history_request':
				return historyResultCommand(id, request, await recordOf(request.sessionId));
			case 'bridge.platform_request':
				return platformResultCommand(
					id,
					request,
					await answerPlatformRequest(request, {
						db,
						commands: context.commands,
						events: context.events,
						checkoutsRoot: context.checkoutsRoot,
						sending,
						deliveries,
						...(deps.secrets ? { secrets: deps.secrets } : {}),
						nameWorkstream: (workstreamId, prompt) => namer.nameWorkstream(workstreamId, prompt),
						log,
					}),
				);
			case 'bridge.browser_request':
				return browserResultCommand(
					id,
					request,
					await answerBrowserRequest(request, {
						db,
						checkoutsRoot: context.checkoutsRoot,
						browser: deps.browser,
					}),
				);
		}
	}

	async function recordOf(sessionId: string): Promise<HistoryAnswer> {
		if (!optimizesContext((await savedSettings())[OPTIMIZE_CONTEXT_SETTING])) {
			return { ok: true, messages: [] };
		}
		try {
			return { ok: true, messages: conversationRecord(db, sessionId) ?? [] };
		} catch (error) {
			log(`agent: could not hand chat \`${sessionId}\` its record back: ${describe(error)}`);
			return { ok: false, error: describe(error) };
		}
	}

	function savedSettings(): Promise<Readonly<Record<string, string>>> {
		return context.commands
			.call('app.list-settings', undefined)
			.catch((): Record<string, string> => ({}));
	}

	let started = false;
	if (existsSync(bridgeScriptPath)) {
		started = await runtime.start();
	} else {
		log(`agent: ${missingBridgeScriptMessage(bridgeScriptPath)}`);
	}

	const commandDeps: BridgeCommandDeps = {
		db,
		runtime,
		checkoutsRoot: context.checkoutsRoot,
		ids: new IdSequence(),
		leases: deps.leases,
		sending,
		providerEnvironment: deps.providerEnvironment ?? (async () => ({})),
		hooks: {
			...(deps.verifyAttachment ? { verifyAttachment: deps.verifyAttachment } : {}),
			...(deps.collectAttachmentGarbage
				? { collectAttachmentGarbage: deps.collectAttachmentGarbage }
				: {}),
			...(deps.prepareAttachments ? { prepareAttachments: deps.prepareAttachments } : {}),
			...(deps.theme ? { theme: deps.theme } : {}),
			...(deps.shippingFailure ? { shippingFailure: deps.shippingFailure } : {}),
			...(deps.shellRuns ? { shellRuns: deps.shellRuns } : {}),
			...(deps.secrets ? { secrets: secretsReaching(db, deps.secrets) } : {}),
			...(deps.plugins ? { plugins: deps.plugins } : {}),
			boundary: (automation) =>
				agentBoundary(automation, {
					appDataRoot: context.appDataRoot,
					appDataEntries: appDataEntries(context.appDataRoot),
					checkoutsRoot: context.checkoutsRoot,
					checkouts: listWorkstreams(db),
				}),
			async turnSettings() {
				const settings = await savedSettings();
				return {
					compactWindow: optimizesContext(settings[OPTIMIZE_CONTEXT_SETTING])
						? contextWindowOf(settings[CONTEXT_WINDOW_SETTING])
						: null,
					steReplies: writesSte(settings[STE_REPLIES_SETTING]),
				};
			},
			captureCheckpoint: deps.hooks.captureCheckpoint,
			captureRunFinish: (runId) => runtime.notifyRunFinished(runId, 'not-delivered'),
			closing: () => runtime.wasStopped,
			promptSent: (sessionId, workstreamId, prompt) => {
				namer.promptSent(sessionId, workstreamId, prompt);
			},
		},
		log,
	};
	const sendPrompt = defineBridgeCommands(context.commands, commandDeps);
	const stopRecordingDenials = context.commands.observe((outcome) =>
		recordDeniedMaliniCall(context, outcome),
	);

	return {
		runtime,
		namer,
		bridgeScriptPath,
		started,
		health() {
			return runtime.currentIfRunning()?.health() ?? { state: 'pending' };
		},
		ensureReady: () => runtime.ensureReady(),
		closeOpenRunsForExit,
		continuePausedRuns: (causeEventId) =>
			started ? continuePausedRuns(db, sendPrompt, causeEventId, log) : Promise.resolve(),
		async continuePausedRun(paused, causeEventId) {
			if (!started) return;
			try {
				await continuePausedRun(db, sendPrompt, paused, causeEventId);
			} catch (error) {
				log(`agent: could not continue paused run \`${paused.runId}\`: ${describe(error)}`);
			}
		},
		async handOutSecrets(repository) {
			const supervisor = runtime.currentIfRunning();
			const { secrets } = deps;
			if (!secrets || !supervisor?.isHealthy()) return;
			for (const sessionId of new Set(listOpenRuns(db).map((run) => run.sessionId))) {
				const workstreamId = persistedBridgeSession(db, sessionId)?.workstreamId;
				const reached =
					workstreamId === undefined ? null : await workstreamRepositoryName(db, workstreamId);
				if (repository !== null && reached?.toLowerCase() !== repository.toLowerCase()) continue;
				try {
					await supervisor.sendCommand({
						cmd: 'set_secrets',
						id: supervisor.nextCommandId(),
						sessionId,
						secrets: secrets.valuesReaching(reached),
					});
				} catch (error) {
					log(`agent: could not hand the secrets to \`${sessionId}\`: ${describe(error)}`);
				}
			}
		},
		async stop() {
			stopRecordingDenials();
			stopNamingTurns();
			await runtime.pauseOpenRuns(PAUSE_BUDGET_MS);
			await runtime.stop();
			await closeOpenRunsForExit();
		},
	};

	async function closeOpenRunsForExit(): Promise<number> {
		let reaped: string[];
		try {
			reaped = reapOrphansOnExit(db, (envelope, seq) => runtime.emitSynthetic(envelope, seq));
		} catch (error) {
			log(`agent: exit orphan reap failed: ${describe(error)}`);
			return 0;
		}
		for (const runId of reaped) {
			await runtime.notifyRunFinished(runId, 'app-exit');
		}
		return reaped.length;
	}
}

function secretsReaching(
	db: MaliniDatabase,
	secrets: SecretsPlatform,
): (workstreamId: string) => Promise<Readonly<Record<string, string>>> {
	return async (workstreamId) =>
		secrets.valuesReaching(await workstreamRepositoryName(db, workstreamId));
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
