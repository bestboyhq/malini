import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
	CHAT_SESSION_RENAMED_CHANNEL,
	REPOSITORIES_WORKSTREAM_RENAMED_CHANNEL,
	type SessionRenamedPayload,
	type WorkstreamRenamedPayload,
} from '$contract/events';
import { CONTEXT_WINDOW_SETTING, contextWindowOf } from '$contract/agent';
import type { BrowserTabArgs } from '$contract/browser';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import type { SecretsPlatform } from '$lib/secrets/secrets.platform';
import { workstreamRepositoryName } from '$shared/repositories/repositories.platform';
import { IdSequence } from '../id-sequence';
import { listOpenRuns } from '../runs.repository';
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
import { conversationRecord, persistedBridgeSession, worktreePath } from './sessions';
import type { BridgeHealth, BridgeSupervisor } from './supervisor';

const PAUSE_BUDGET_MS = 5_000;
const RESIZE_ROUNDING_PX = 1;

export interface BrowserPageInfo {
	readonly url: string;
	readonly title: string;
}

export interface BrowserAutomation {
	open(tab: BrowserTabArgs, url: string): Promise<BrowserPageInfo>;
	screenshot(
		tab: BrowserTabArgs,
		worktree: string,
	): Promise<{ readonly path: string; readonly previewPath: string; readonly url: string }>;
	click(tab: BrowserTabArgs, selector: string): Promise<BrowserPageInfo>;
	type(
		tab: BrowserTabArgs,
		selector: string,
		text: string,
		submit: boolean,
	): Promise<BrowserPageInfo>;
	goBack(tab: BrowserTabArgs): Promise<BrowserPageInfo>;
	goForward(tab: BrowserTabArgs): Promise<BrowserPageInfo>;
	reload(tab: BrowserTabArgs): Promise<BrowserPageInfo>;
	resize(tab: BrowserTabArgs, width: number): Promise<number>;
}

export interface AgentServiceDeps {
	readonly processFactory?: BridgeProcessFactory;
	readonly spawnEnvironment: () => Readonly<Record<string, string>>;
	readonly leases: AgentRunLeases;
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
	readonly appDataRoot: string;
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
			case 'screenshot': {
				const shot = await browser.screenshot(tab, worktreePath(deps.appDataRoot, workstreamId));
				return {
					ok: true,
					text: `Screenshot of ${shot.url} saved to ${shot.path}. Embed it in your report as ![what it shows](${shot.path}).`,
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
			case 'type': {
				const { selector, text, submit } = request;
				const page = await browser.type(tab, selector, text, submit);
				const enter = submit ? ' and pressed Enter' : '';
				return {
					ok: true,
					text: `Typed into \`${selector}\`${enter}. The page is now ${describePage(page)}.`,
				};
			}
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
			case 'resize':
				return {
					ok: true,
					text: describeWidth(request.width, await browser.resize(tab, request.width)),
				};
		}
	} catch (error) {
		return { ok: false, error: describe(error) };
	}
}

export function agentBrowserTabId(sessionId: string): string {
	return `chat-${sessionId}`;
}

function describeWidth(asked: number, width: number): string {
	if (width < asked - RESIZE_ROUNDING_PX) {
		return `The page is now ${width}px wide, the widest Malini's window allows while the chat keeps its minimum width.`;
	}
	if (width > asked + RESIZE_ROUNDING_PX) {
		return `The page is now ${width}px wide, the narrowest the inspector gets in Malini's window.`;
	}
	return `The page is now ${width}px wide.`;
}

function describePage(page: BrowserPageInfo): string {
	const title = page.title.trim();
	return title.length > 0 && title !== page.url ? `${page.url} ("${title}")` : page.url;
}

export interface AgentService {
	readonly runtime: BridgeRuntime;
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
		appDataRoot: context.appDataRoot,
		leases: deps.leases,
		supervisorConfig: {
			processFactory: deps.processFactory ?? createElectronNodeProcessFactory(),
			spawn: {
				scriptPath: bridgeScriptPath,
				args: ['--stdio'],
				env: {
					...deps.spawnEnvironment(),
					AGENT_BRIDGE_LOG: join(context.appDataRoot, 'agent-bridge.log'),
					MALINI_AGENT_BRIDGE_PRIVATE_RUNTIME_ROOT: privateRuntimeRoot,
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
				return historyResultCommand(id, request, recordOf(request.sessionId));
			case 'bridge.platform_request':
				return platformResultCommand(
					id,
					request,
					await answerPlatformRequest(request, {
						db,
						commands: context.commands,
						events: context.events,
						appDataRoot: context.appDataRoot,
						sending,
						deliveries,
						...(deps.secrets ? { secrets: deps.secrets } : {}),
						log,
					}),
				);
			case 'bridge.browser_request':
				return browserResultCommand(
					id,
					request,
					await answerBrowserRequest(request, {
						db,
						appDataRoot: context.appDataRoot,
						browser: deps.browser,
					}),
				);
		}
	}

	function recordOf(sessionId: string): HistoryAnswer {
		try {
			return { ok: true, messages: conversationRecord(db, sessionId) ?? [] };
		} catch (error) {
			log(`agent: could not hand chat \`${sessionId}\` its record back: ${describe(error)}`);
			return { ok: false, error: describe(error) };
		}
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
		appDataRoot: context.appDataRoot,
		ids: new IdSequence(),
		leases: deps.leases,
		sending,
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
			async compactWindow() {
				const settings = await context.commands
					.call('app.list-settings', undefined)
					.catch((): Record<string, string> => ({}));
				return contextWindowOf(settings[CONTEXT_WINDOW_SETTING]);
			},
			captureCheckpoint: deps.hooks.captureCheckpoint,
			captureRunFinish: (runId) => runtime.notifyRunFinished(runId, 'not-delivered'),
			closing: () => runtime.wasStopped,
			notifySessionRenamed(workstreamId, sessionId, name) {
				const payload: SessionRenamedPayload = { workstreamId, sessionId, name };
				context.events.emit(CHAT_SESSION_RENAMED_CHANNEL, payload);
			},
			notifyWorkstreamRenamed(workstreamId, name) {
				const payload: WorkstreamRenamedPayload = { workstreamId, name };
				context.events.emit(REPOSITORIES_WORKSTREAM_RENAMED_CHANNEL, payload);
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
