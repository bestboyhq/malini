import { randomUUID } from 'node:crypto';
import { createInterface, type Interface as RLInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
	bridgeBrowserRequestFrame,
	bridgeCapabilitiesFrame,
	bridgeChoiceFrame,
	bridgeCommandAckFrame,
	bridgeHeartbeatFrame,
	bridgeHistoryRequestFrame,
	bridgeMcpAuthorizationFrame,
	bridgeMcpServerFrame,
	bridgeMcpServersFrame,
	bridgeMcpSwitchedFrame,
	bridgePlatformRequestFrame,
	bridgeProtocolErrorFrame,
	bridgeReadyFrame,
	bridgeSkillsFrame,
	bridgeTitleFrame,
	parseCommandLine,
	type AgentCommand,
	type AgentSkill,
	type BridgeControlFrame,
	type CancelMcpAuthorizationCommand,
	type ChooseCommand,
	type ListSkillsCommand,
	type McpServerCommand,
	type SuggestTitleCommand,
	type SwitchMcpServerCommand,
	type TurnedOffSkills,
	type BrowserRequest,
	type BrowserResult,
	type HistoryResult,
	type PlatformRequest,
	type PlatformResult,
	type ProviderCapability,
	type SetSecretsCommand,
	type WatchMcpServersCommand,
} from './protocol.js';
import { probeClaudeCode, unknownCapability } from './claude/capabilities.js';
import { chooseClaudeCandidate } from './claude/choices.js';
import { registerClaudeProvider } from './claude/index.js';
import {
	claudeMcpServers,
	type McpServerProbes,
	type McpServerWatch,
} from './claude/mcp-servers.js';
import { listClaudeSkills } from './claude/skills.js';
import { suggestClaudeTitle, type TitleJob } from './claude/titles.js';
import { BRIDGE_HEARTBEAT_INTERVAL_MS } from './generated/protocol-contract.js';
import { sanitizePublicError } from './error-sanitizer.js';
import { SessionManager, UnknownSessionError } from './session-manager.js';
import { defaultProviderRegistry } from './providers/registry.js';
import type { ProviderContext, ProviderHandle } from './providers/types.js';
import { ProviderInteractionError } from './provider-interactions.js';
import type { AgentEvent, McpServerReport } from './types.js';

export interface OutputSink {
	write(chunk: string): boolean;
	once(event: 'drain', listener: () => void): unknown;
}

export interface RunOptions {
	stdin?: NodeJS.ReadableStream;
	stdout?: OutputSink;
	stderr?: OutputSink;
	idleTimeoutMs?: number | null;
	exit?: (code: number) => void;
	capabilityProbe?: () => Promise<ProviderCapability>;
	suggestTitle?: (task: string, job: TitleJob) => Promise<string>;
	choose?: (task: string, job: TitleJob, choices: number) => Promise<number>;
	listSkills?: (cwd: string, turnedOff?: TurnedOffSkills) => Promise<readonly AgentSkill[]>;
	mcpServers?: McpServerProbes;
	closeSessionTimeoutMs?: number;
	requestTimeoutMs?: number;
}

export interface IpcBundle {
	parse: typeof parseCommandLine;
	manager: SessionManager;
	run: (line: string) => Promise<void>;
	inFlight(): number;
	drain(): Promise<void>;
	emitControl(frame: BridgeControlFrame): void;
}

export interface AttachedIpc extends IpcBundle {
	stopTracking(): void;
}

const CAPABILITY_DISCOVERY_FAILURE_MESSAGE = 'Could not check Claude Code';
const REQUEST_TIMEOUT_MS = 60_000;
const MCP_WATCH_LEASE_MS = 90_000;

interface McpWatcher {
	readonly watch: McpServerWatch;
	readonly plugins: readonly string[];
	lease: NodeJS.Timeout;
}

type AnswerResult = BrowserResult | HistoryResult;

interface PendingRequest {
	readonly sessionId: string;
	readonly settle: (result: AnswerResult) => void;
}

export class BridgeOutputWriter {
	readonly #stream: OutputSink;
	readonly #controlQueue: string[] = [];
	readonly #eventQueue: string[] = [];
	#pendingHeartbeat: string | null = null;
	#blocked = false;
	#pumping = false;
	readonly #drainWaiters: Array<() => void> = [];

	constructor(stream: OutputSink) {
		this.#stream = stream;
	}

	writeControl(frame: BridgeControlFrame): void {
		const safeFrame = sanitizeControlFrameErrors(frame);
		const line = jsonLine(safeFrame);
		if (frame.type === 'bridge.heartbeat') {
			this.#pendingHeartbeat = line;
		} else {
			this.#controlQueue.push(line);
		}
		this.#pump();
	}

	writeEvent(event: AgentEvent): void {
		this.#eventQueue.push(jsonLine(sanitizeEventErrors(event)));
		this.#pump();
	}

	drain(): Promise<void> {
		if (this.#isIdle()) return Promise.resolve();
		return new Promise((resolve) => this.#drainWaiters.push(resolve));
	}

	#nextLine(): string | undefined {
		const control = this.#controlQueue.shift();
		if (control !== undefined) return control;
		if (this.#pendingHeartbeat !== null) {
			const heartbeat = this.#pendingHeartbeat;
			this.#pendingHeartbeat = null;
			return heartbeat;
		}
		return this.#eventQueue.shift();
	}

	#pump(): void {
		if (this.#blocked || this.#pumping) return;
		this.#pumping = true;
		try {
			while (!this.#blocked) {
				const line = this.#nextLine();
				if (line === undefined) break;
				if (!this.#stream.write(line)) {
					this.#blocked = true;
					this.#stream.once('drain', () => {
						this.#blocked = false;
						this.#pump();
					});
				}
			}
		} finally {
			this.#pumping = false;
		}
		this.#settleDrainWaiters();
	}

	#isIdle(): boolean {
		return (
			!this.#blocked &&
			!this.#pumping &&
			this.#controlQueue.length === 0 &&
			this.#pendingHeartbeat === null &&
			this.#eventQueue.length === 0
		);
	}

	#settleDrainWaiters(): void {
		if (!this.#isIdle()) return;
		for (const resolve of this.#drainWaiters.splice(0)) resolve();
	}
}

function sanitizeControlFrameErrors(frame: BridgeControlFrame): BridgeControlFrame {
	switch (frame.type) {
		case 'bridge.command_ack':
			return frame.error === undefined
				? frame
				: { ...frame, error: sanitizePublicError(frame.error) };
		case 'bridge.protocol_error':
			return { ...frame, message: sanitizePublicError(frame.message) };
		case 'bridge.mcp_server':
			return { ...frame, server: sanitizeMcpServer(frame.server) };
		case 'bridge.mcp_servers':
			return {
				...frame,
				servers: frame.servers.map(sanitizeMcpServer),
				...(frame.error === undefined ? {} : { error: sanitizePublicError(frame.error) }),
			};
		default:
			return frame;
	}
}

function sanitizeMcpServer(server: McpServerReport): McpServerReport {
	return server.error === undefined
		? server
		: { ...server, error: sanitizePublicError(server.error) };
}

function sanitizeEventErrors(event: AgentEvent): AgentEvent {
	switch (event.type) {
		case 'run.failed':
		case 'tool.failed':
			return { ...event, error: sanitizePublicError(event.error) };
		case 'mcp.status':
			return { ...event, servers: event.servers.map(sanitizeMcpServer) };
		default:
			return event;
	}
}

async function resolveProviderCapabilities(
	capabilityProbe: RunOptions['capabilityProbe'] = probeClaudeCode,
): Promise<ProviderCapability[]> {
	try {
		return [await capabilityProbe()];
	} catch {
		return [unknownCapability(CAPABILITY_DISCOVERY_FAILURE_MESSAGE)];
	}
}

export function createIpc(options: RunOptions = {}): IpcBundle {
	const manager = new SessionManager();
	const handles = new Map<string, ProviderHandle>();
	const sessionFolders = new Map<string, string>();
	const mcpServers = options.mcpServers ?? claudeMcpServers;
	const signIns = new Map<string, () => void>();
	const watchers = new Map<string, McpWatcher>();
	const switches = new Map<string, Promise<void>>();
	const startingSessions = new Map<string, Promise<void>>();
	const inFlightPromises = new Set<Promise<void>>();
	const activeRunSessions = new Set<string>();
	const activeRunIdsBySession = new Map<string, Set<string>>();
	const closeSessionTimeoutMs = options.closeSessionTimeoutMs ?? 3_500;
	const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
	const pendingRequests = new Map<string, PendingRequest>();
	const stdout = options.stdout ?? process.stdout;
	const output = new BridgeOutputWriter(stdout);

	manager.onAgentEvent((ev) => output.writeEvent(ev));

	function emitControl(frame: BridgeControlFrame): void {
		output.writeControl(frame);
	}

	async function run(line: string): Promise<void> {
		const parsed = parseCommandLine(line);
		if (!parsed.ok) {
			if (parsed.requestId !== undefined && parsed.sessionId !== undefined) {
				settleRequest(parsed.sessionId, parsed.requestId, {
					ok: false,
					error: `Malini sent an invalid answer: ${parsed.message}`,
				});
			}
			emitControl(bridgeProtocolErrorFrame(parsed));
			return;
		}
		const cmd = parsed.command;
		if (cmd.cmd === 'refresh_capabilities') {
			const capabilities = await resolveProviderCapabilities(options.capabilityProbe);
			emitControl(bridgeCapabilitiesFrame(capabilities));
			emitControl(bridgeCommandAckFrame(cmd.id));
			return;
		}
		if (cmd.cmd === 'suggest_title') {
			trackInFlight(answerTitle(cmd));
			return;
		}
		if (cmd.cmd === 'choose') {
			trackInFlight(answerChoice(cmd));
			return;
		}
		if (cmd.cmd === 'list_skills') {
			trackInFlight(answerSkills(cmd));
			return;
		}
		if (cmd.cmd === 'authorize_mcp_server' || cmd.cmd === 'reconnect_mcp_server') {
			trackInFlight(answerMcpServer(cmd));
			return;
		}
		if (cmd.cmd === 'watch_mcp_servers') {
			watchMcpServers(cmd);
			return;
		}
		if (cmd.cmd === 'switch_mcp_server') {
			trackInFlight(queueMcpSwitch(cmd));
			return;
		}
		if (cmd.cmd === 'cancel_mcp_authorization') {
			cancelSignIn(cmd);
			return;
		}
		switch (cmd.cmd) {
			case 'start_session': {
				const error = await handleStartSession(cmd);
				emitControl(bridgeCommandAckFrame(cmd.id, error ?? undefined));
				return;
			}
			case 'send_prompt': {
				emitControl(bridgeCommandAckFrame(cmd.id));
				trackInFlight(handleSendPrompt(cmd));
				return;
			}
			case 'cancel_run': {
				const error = await handleCancelRun(cmd);
				await output.drain();
				emitControl(bridgeCommandAckFrame(cmd.id, error ?? undefined));
				return;
			}
			case 'close_session': {
				const error = await handleCloseSession(cmd);
				emitControl(bridgeCommandAckFrame(cmd.id, error ?? undefined));
				return;
			}
			case 'refresh_session_status': {
				const error = await handleRefreshSessionStatus(cmd);
				emitControl(bridgeCommandAckFrame(cmd.id, error ?? undefined));
				return;
			}
			case 'stop_task': {
				const error = await handleStopTask(cmd);
				emitControl(bridgeCommandAckFrame(cmd.id, error ?? undefined));
				return;
			}
			case 'approve': {
				const error = await handleApprove(cmd);
				emitControl(bridgeCommandAckFrame(cmd.id, error ?? undefined));
				return;
			}
			case 'answer_question': {
				const error = await handleAnswerQuestion(cmd);
				emitControl(bridgeCommandAckFrame(cmd.id, error ?? undefined));
				return;
			}
			case 'set_secrets': {
				const error = await handleSetSecrets(cmd);
				emitControl(bridgeCommandAckFrame(cmd.id, error ?? undefined));
				return;
			}
			case 'browser_result':
			case 'platform_result':
			case 'history_result': {
				const known = settleRequest(cmd.sessionId, cmd.requestId, cmd);
				emitControl(
					bridgeCommandAckFrame(
						cmd.id,
						known
							? undefined
							: `UNKNOWN_REQUEST: ${cmd.requestId} is not pending in session ${cmd.sessionId}`,
					),
				);
				return;
			}
		}
	}

	function requestBrowser(sessionId: string, request: BrowserRequest): Promise<BrowserResult> {
		return awaitAnswer(sessionId, "Malini's browser", (requestId) =>
			bridgeBrowserRequestFrame(requestId, sessionId, request),
		);
	}

	function requestPlatform(sessionId: string, request: PlatformRequest): Promise<PlatformResult> {
		return awaitAnswer(sessionId, 'Malini', (requestId) =>
			bridgePlatformRequestFrame(requestId, sessionId, request),
		);
	}

	function requestHistory(sessionId: string): Promise<HistoryResult> {
		return awaitAnswer(sessionId, 'Malini', (requestId) =>
			bridgeHistoryRequestFrame(requestId, sessionId),
		);
	}

	function awaitAnswer(
		sessionId: string,
		answerer: string,
		frame: (requestId: string) => BridgeControlFrame,
	): Promise<AnswerResult> {
		const requestId = randomUUID();
		return new Promise((resolve) => {
			const timeout = setTimeout(
				() =>
					settleRequest(sessionId, requestId, {
						ok: false,
						error: `${answerer} did not answer within ${requestTimeoutMs} ms.`,
					}),
				requestTimeoutMs,
			);
			pendingRequests.set(requestId, {
				sessionId,
				settle: (result) => {
					clearTimeout(timeout);
					resolve(result);
				},
			});
			emitControl(frame(requestId));
		});
	}

	function settleRequest(sessionId: string, requestId: string, result: AnswerResult): boolean {
		const pending = pendingRequests.get(requestId);
		if (pending?.sessionId !== sessionId) return false;
		pendingRequests.delete(requestId);
		pending.settle(result);
		return true;
	}

	function abandonRequests(sessionId: string, error: string): void {
		for (const [requestId, pending] of pendingRequests) {
			if (pending.sessionId === sessionId) {
				settleRequest(sessionId, requestId, { ok: false, error });
			}
		}
	}

	async function handleStartSession(cmd: AgentCommand): Promise<string | null> {
		if (cmd.cmd !== 'start_session') return 'invalid start_session command';
		if (!defaultProviderRegistry.hasProvider()) {
			const error = 'UNKNOWN_PROVIDER: no agent factory is registered';
			manager.emitAgentEvent({
				type: 'session.state',
				sessionId: cmd.sessionId,
				status: 'failed',
			});
			emitFailure('UNKNOWN_PROVIDER', 'no agent factory is registered');
			return error;
		}
		const existing = manager.get(cmd.sessionId);
		if (existing) {
			if (existing.workstreamId !== cmd.workstreamId) {
				const error = `ALREADY_OPEN: session ${cmd.sessionId} is already registered with different metadata`;
				emitFailure(
					'ALREADY_OPEN',
					`session ${cmd.sessionId} is already registered with different metadata`,
				);
				return error;
			}
			const starting = startingSessions.get(cmd.sessionId);
			if (starting) await starting;
			const sameRuntime =
				existing.model === cmd.model &&
				(cmd.providerSessionId === undefined ||
					existing.providerSessionId === undefined ||
					existing.providerSessionId === cmd.providerSessionId);
			const existingHandle = handles.get(cmd.sessionId);
			if (sameRuntime && existingHandle) {
				if (cmd.providerSessionId !== undefined) {
					manager.setProviderSessionId(cmd.sessionId, cmd.providerSessionId);
				}
				return null;
			}
			if (activeRunSessions.has(cmd.sessionId)) {
				const error = `SESSION_BUSY: session ${cmd.sessionId} has an active run; wait for it to finish before changing its model`;
				emitFailure(
					'SESSION_BUSY',
					`session ${cmd.sessionId} has an active run; wait for it to finish before changing its model`,
				);
				return error;
			}
			if (existingHandle) {
				try {
					await existingHandle.close();
				} catch {
					const error = `SESSION_REBIND_FAILED: session ${cmd.sessionId} could not close its previous handle`;
					emitFailure(
						'SESSION_REBIND_FAILED',
						`session ${cmd.sessionId} could not close its previous handle`,
					);
					return error;
				}
				handles.delete(cmd.sessionId);
			}
			manager.unregister(cmd.sessionId);
		}

		manager.register({
			sessionId: cmd.sessionId,
			workstreamId: cmd.workstreamId,
			...(cmd.model !== undefined ? { model: cmd.model } : {}),
			...(cmd.providerSessionId !== undefined ? { providerSessionId: cmd.providerSessionId } : {}),
		});
		const ctx = providerContext(cmd);
		sessionFolders.set(cmd.sessionId, ctx.cwd);
		let startupError: string | null = null;
		const starting = (async (): Promise<void> => {
			try {
				const handle = await defaultProviderRegistry.getProvider(ctx, (agentEv) =>
					manager.emitAgentEvent(agentEv),
				);
				handles.set(cmd.sessionId, handle);
				manager.emitAgentEvent({
					type: 'session.state',
					sessionId: cmd.sessionId,
					status: 'idle',
				});
			} catch (err) {
				startupError = `START_SESSION_FAILED: ${errorMessage(err)}`;
				manager.setStatus(cmd.sessionId, 'failed');
				manager.emitAgentEvent({
					type: 'session.state',
					sessionId: cmd.sessionId,
					status: 'failed',
				});
				emitFailure('START_SESSION_FAILED', errorMessage(err));
			}
		})();
		startingSessions.set(cmd.sessionId, starting);
		try {
			await starting;
		} finally {
			startingSessions.delete(cmd.sessionId);
		}
		return startupError;
	}

	function providerContext(cmd: Extract<AgentCommand, { cmd: 'start_session' }>): ProviderContext {
		return {
			sessionId: cmd.sessionId,
			workstreamId: cmd.workstreamId,
			cwd: cmd.worktreePath ?? process.cwd(),
			...(cmd.model !== undefined ? { model: cmd.model } : {}),
			...(cmd.providerSessionId !== undefined ? { providerSessionId: cmd.providerSessionId } : {}),
			...(cmd.conversationHistory !== undefined
				? { conversationHistory: cmd.conversationHistory }
				: {}),
			requestBrowser: (request) => requestBrowser(cmd.sessionId, request),
			requestPlatform: (request) => requestPlatform(cmd.sessionId, request),
			requestHistory: () => requestHistory(cmd.sessionId),
		};
	}

	function trackInFlight(task: Promise<void>): void {
		inFlightPromises.add(task);
		void (async (): Promise<void> => {
			try {
				await task;
			} catch {}
			inFlightPromises.delete(task);
		})();
	}

	async function handleSendPrompt(cmd: AgentCommand): Promise<void> {
		if (cmd.cmd !== 'send_prompt') return;
		const starting = startingSessions.get(cmd.sessionId);
		if (starting) await starting;
		const handle = handles.get(cmd.sessionId);
		if (!handle) {
			emitRunFailure(
				cmd.runId,
				cmd.sessionId,
				'NO_SESSION',
				`no active session for ${cmd.sessionId}`,
			);
			return;
		}
		activeRunSessions.add(cmd.sessionId);
		const activeRunIds = activeRunIdsBySession.get(cmd.sessionId) ?? new Set<string>();
		activeRunIds.add(cmd.runId);
		activeRunIdsBySession.set(cmd.sessionId, activeRunIds);
		try {
			if (cmd.secrets) await handle.setSecrets?.(cmd.secrets);
			await handle.sendPrompt(
				cmd.prompt,
				cmd.runId,
				cmd.profile,
				cmd.resumeAt,
				cmd.freshConversation,
				cmd.skills,
				cmd.steer,
				cmd.theme,
				cmd.lineage,
				cmd.plugins,
				cmd.compactWindow,
				cmd.boundary,
			);
		} catch (err) {
			emitRunFailure(cmd.runId, cmd.sessionId, 'SEND_PROMPT_FAILED', errorMessage(err));
		} finally {
			activeRunIds.delete(cmd.runId);
			if (activeRunIds.size === 0) {
				activeRunIdsBySession.delete(cmd.sessionId);
				activeRunSessions.delete(cmd.sessionId);
			}
		}
	}

	async function answerTitle(cmd: SuggestTitleCommand): Promise<void> {
		try {
			const title = await (options.suggestTitle ?? suggestClaudeTitle)(cmd.prompt, {
				instructions: cmd.instructions,
				model: cmd.model,
			});
			emitControl(bridgeTitleFrame(cmd.id, title));
			emitControl(bridgeCommandAckFrame(cmd.id));
		} catch (err) {
			emitControl(bridgeCommandAckFrame(cmd.id, `TITLE_FAILED: ${errorMessage(err)}`));
		}
	}

	async function answerChoice(cmd: ChooseCommand): Promise<void> {
		try {
			const pick = await (options.choose ?? chooseClaudeCandidate)(
				cmd.prompt,
				{ instructions: cmd.instructions, model: cmd.model },
				cmd.choices,
			);
			emitControl(bridgeChoiceFrame(cmd.id, pick));
			emitControl(bridgeCommandAckFrame(cmd.id));
		} catch (err) {
			emitControl(bridgeCommandAckFrame(cmd.id, `CHOICE_FAILED: ${errorMessage(err)}`));
		}
	}

	async function answerSkills(cmd: ListSkillsCommand): Promise<void> {
		try {
			const skills = await (options.listSkills ?? listClaudeSkills)(cmd.cwd, cmd.turnedOff);
			emitControl(bridgeSkillsFrame(cmd.id, skills));
			emitControl(bridgeCommandAckFrame(cmd.id));
		} catch (err) {
			emitControl(bridgeCommandAckFrame(cmd.id, `SKILLS_FAILED: ${errorMessage(err)}`));
		}
	}

	async function answerMcpServer(cmd: McpServerCommand): Promise<void> {
		let cwd: string;
		let handle: ProviderHandle | undefined;
		if ('sessionId' in cmd) {
			const starting = startingSessions.get(cmd.sessionId);
			if (starting) await starting;
			handle = handles.get(cmd.sessionId);
			const folder = sessionFolders.get(cmd.sessionId);
			if (!handle || folder === undefined) {
				emitControl(
					bridgeCommandAckFrame(cmd.id, `NO_SESSION: no active session for ${cmd.sessionId}`),
				);
				return;
			}
			cwd = folder;
		} else {
			cwd = cmd.cwd;
		}
		const plugins = cmd.plugins ?? [];
		try {
			if (cmd.cmd === 'authorize_mcp_server') {
				closeSignIn(cmd.serverName);
				const { authUrl, settled, cancel } = await mcpServers.authorize(
					cwd,
					cmd.serverName,
					plugins,
				);
				closeSignIn(cmd.serverName);
				signIns.set(cmd.serverName, cancel);
				void announceOnceSettled(settled.finally(() => forgetSignIn(cmd.serverName, cancel)));
				emitControl(bridgeMcpAuthorizationFrame(cmd.id, authUrl));
			} else if (handle) {
				if (!handle.reconnectMcpServer)
					throw new Error('the provider cannot reconnect MCP servers');
				await handle.reconnectMcpServer(cmd.serverName, plugins);
			} else {
				const watch = watchers.get(cwd)?.watch;
				const server = watch
					? await watch.reconnect(cmd.serverName)
					: await mcpServers.probe(cwd, cmd.serverName, plugins);
				if (!server) throw new Error(`Claude Code has no MCP server named ${cmd.serverName}`);
				await announceMcpServer(server, watch);
			}
			emitControl(bridgeCommandAckFrame(cmd.id));
		} catch (err) {
			emitControl(bridgeCommandAckFrame(cmd.id, `MCP_SERVER_FAILED: ${errorMessage(err)}`));
		}
	}

	function cancelSignIn(cmd: CancelMcpAuthorizationCommand): void {
		closeSignIn(cmd.serverName);
		emitControl(bridgeCommandAckFrame(cmd.id));
	}

	function closeSignIn(serverName: string): void {
		const cancel = signIns.get(serverName);
		signIns.delete(serverName);
		cancel?.();
	}

	function forgetSignIn(serverName: string, cancel: () => void): void {
		if (signIns.get(serverName) === cancel) signIns.delete(serverName);
	}

	async function announceOnceSettled(settled: Promise<McpServerReport | null>): Promise<void> {
		const server = await settled.catch(() => null);
		if (server) await announceMcpServer(server);
	}

	async function announceMcpServer(
		server: McpServerReport,
		announcedBy?: McpServerWatch,
	): Promise<void> {
		if (server.status === 'connected') {
			await Promise.all([
				...[...handles.values()].map((handle) =>
					handle.adoptMcpServer?.(server).catch(() => undefined),
				),
				...[...watchers.values()]
					.filter(({ watch }) => watch !== announcedBy)
					.map(({ watch }) => watch.reconnect(server.name).catch(() => undefined)),
			]);
		}
		emitControl(bridgeMcpServerFrame(server));
	}

	function watchMcpServers(cmd: WatchMcpServersCommand): void {
		const watching = watchers.get(cmd.cwd);
		const plugins = cmd.plugins ?? [];
		const stale = cmd.restart || JSON.stringify(watching?.plugins) !== JSON.stringify(plugins);
		if (watching && stale) {
			clearTimeout(watching.lease);
			watching.watch.close();
			watchers.delete(cmd.cwd);
		} else if (watching) {
			clearTimeout(watching.lease);
			watching.lease = leaseFor(cmd.cwd);
			const listing = watching.watch.current();
			if (listing) emitControl(bridgeMcpServersFrame(cmd.cwd, listing));
			emitControl(bridgeCommandAckFrame(cmd.id));
			return;
		}
		try {
			const watch = mcpServers.watch(
				cmd.cwd,
				(listing) => emitControl(bridgeMcpServersFrame(cmd.cwd, listing)),
				plugins,
			);
			watchers.set(cmd.cwd, { watch, plugins, lease: leaseFor(cmd.cwd) });
			emitControl(bridgeCommandAckFrame(cmd.id));
		} catch (err) {
			emitControl(bridgeCommandAckFrame(cmd.id, `MCP_SERVERS_FAILED: ${errorMessage(err)}`));
		}
	}

	function leaseFor(cwd: string): NodeJS.Timeout {
		const lease = setTimeout(() => {
			watchers.get(cwd)?.watch.close();
			watchers.delete(cwd);
		}, MCP_WATCH_LEASE_MS);
		lease.unref();
		return lease;
	}

	async function queueMcpSwitch(cmd: SwitchMcpServerCommand): Promise<void> {
		const previous = switches.get(cmd.serverName);
		const queued = (async (): Promise<void> => {
			await previous;
			await switchMcpServer(cmd);
		})();
		switches.set(cmd.serverName, queued);
		try {
			await queued;
		} finally {
			if (switches.get(cmd.serverName) === queued) switches.delete(cmd.serverName);
		}
	}

	async function switchMcpServer(cmd: SwitchMcpServerCommand): Promise<void> {
		absorbMcpConfig();
		const live = await Promise.all(
			[...handles].map(async ([sessionId, handle]) => {
				const folder = sessionFolders.get(sessionId);
				const switched = await handle.switchMcpServer?.(cmd.serverName, cmd.on).catch(() => false);
				return switched && folder !== undefined ? [folder] : [];
			}),
		);
		const switched = new Set(live.flat());
		absorbMcpConfig();
		if (!cmd.on) {
			emitControl(bridgeMcpSwitchedFrame(cmd.id, [...switched]));
			emitControl(bridgeCommandAckFrame(cmd.id));
			return;
		}
		await Promise.all(
			[...watchers.values()].map(({ watch }) => watch.turnOn(cmd.serverName).catch(() => false)),
		);
		const cleared: string[] = [];
		for (const folder of cmd.folders) {
			const clear = switched.has(folder)
				? true
				: await mcpServers.turnOn(folder, cmd.serverName, cmd.plugins ?? []).catch(() => false);
			if (clear) cleared.push(folder);
		}
		absorbMcpConfig();
		emitControl(bridgeMcpSwitchedFrame(cmd.id, cleared));
		emitControl(bridgeCommandAckFrame(cmd.id));
	}

	function absorbMcpConfig(): void {
		for (const { watch } of watchers.values()) watch.absorbConfig();
	}

	async function handleCancelRun(cmd: AgentCommand): Promise<string | null> {
		if (cmd.cmd !== 'cancel_run') return 'invalid cancel_run command';
		const handle = handles.get(cmd.sessionId);
		if (!handle) {
			emitFailure('NO_SESSION', `no active session for ${cmd.sessionId}`);
			return `NO_SESSION: no active session for ${cmd.sessionId}`;
		}
		abandonRequests(cmd.sessionId, 'The run was cancelled.');
		try {
			await handle.cancel(cmd.runId);
		} catch {
			const error = 'CANCEL_FAILED: provider cancellation did not finish';
			emitFailure('CANCEL_FAILED', 'provider cancellation did not finish');
			return error;
		}
		try {
			manager.setStatus(cmd.sessionId, 'failed');
		} catch (err) {
			if (!(err instanceof UnknownSessionError)) {
				return `CANCEL_STATE_FAILED: ${errorMessage(err)}`;
			}
		}
		return null;
	}

	async function handleCloseSession(cmd: AgentCommand): Promise<string | null> {
		if (cmd.cmd !== 'close_session') return 'invalid close_session command';
		abandonRequests(cmd.sessionId, 'The session closed.');
		const starting = startingSessions.get(cmd.sessionId);
		if (starting) {
			try {
				await settleWithin(starting, closeSessionTimeoutMs, 'provider session startup');
			} catch (error) {
				return `CLOSE_SESSION_TIMEOUT: ${errorMessage(error)}`;
			}
		}

		const handle = handles.get(cmd.sessionId);
		if (!handle) {
			manager.unregister(cmd.sessionId);
			sessionFolders.delete(cmd.sessionId);
			activeRunSessions.delete(cmd.sessionId);
			activeRunIdsBySession.delete(cmd.sessionId);
			return null;
		}

		let cancellationFailure: string | null = null;
		for (const runId of [...(activeRunIdsBySession.get(cmd.sessionId) ?? [])]) {
			try {
				await settleWithin(
					handle.cancel(runId),
					closeSessionTimeoutMs,
					`provider run ${runId} cancellation`,
				);
			} catch (error) {
				cancellationFailure = errorMessage(error);
				break;
			}
		}

		try {
			await settleWithin(handle.close(), closeSessionTimeoutMs, 'provider session close');
		} catch (error) {
			const cancelDetail = cancellationFailure ? `; cancellation: ${cancellationFailure}` : '';
			return `CLOSE_SESSION_FAILED: ${errorMessage(error)}${cancelDetail}`;
		}

		if (handles.get(cmd.sessionId) === handle) handles.delete(cmd.sessionId);
		manager.unregister(cmd.sessionId);
		sessionFolders.delete(cmd.sessionId);
		activeRunSessions.delete(cmd.sessionId);
		activeRunIdsBySession.delete(cmd.sessionId);
		return null;
	}

	async function handleRefreshSessionStatus(cmd: AgentCommand): Promise<string | null> {
		if (cmd.cmd !== 'refresh_session_status') return 'invalid refresh_session_status command';
		const starting = startingSessions.get(cmd.sessionId);
		if (starting) await starting;
		const handle = handles.get(cmd.sessionId);
		if (!handle) return `NO_SESSION: no active session for ${cmd.sessionId}`;
		if (!handle.refreshSessionStatus) {
			return `SESSION_STATUS_UNSUPPORTED: provider for ${cmd.sessionId} does not expose its session status`;
		}
		try {
			await handle.refreshSessionStatus();
			return null;
		} catch (error) {
			return `SESSION_STATUS_REFRESH_FAILED: ${errorMessage(error)}`;
		}
	}

	async function handleStopTask(cmd: AgentCommand): Promise<string | null> {
		if (cmd.cmd !== 'stop_task') return 'invalid stop_task command';
		const handle = handles.get(cmd.sessionId);
		if (!handle) return `NO_SESSION: no active session for ${cmd.sessionId}`;
		if (!handle.stopTask) {
			return `STOP_TASK_UNSUPPORTED: provider for ${cmd.sessionId} cannot stop a background task`;
		}
		try {
			await handle.stopTask(cmd.runId, cmd.taskId);
			return null;
		} catch (error) {
			return `STOP_TASK_FAILED: ${errorMessage(error)}`;
		}
	}

	async function handleSetSecrets(cmd: SetSecretsCommand): Promise<string | null> {
		const starting = startingSessions.get(cmd.sessionId);
		if (starting) await starting;
		const handle = handles.get(cmd.sessionId);
		if (!handle) return `NO_SESSION: no active session for ${cmd.sessionId}`;
		if (!handle.setSecrets) {
			return `SECRETS_UNSUPPORTED: provider for ${cmd.sessionId} cannot take secrets`;
		}
		try {
			await handle.setSecrets(cmd.secrets);
			return null;
		} catch (error) {
			return `SET_SECRETS_FAILED: ${errorMessage(error)}`;
		}
	}

	async function handleApprove(cmd: AgentCommand): Promise<string | null> {
		if (cmd.cmd !== 'approve') return 'invalid approve command';
		const handle = await activeInteractionHandle(cmd.sessionId, cmd.runId);
		if (typeof handle === 'string') return handle;
		if (!handle.respondToApproval) {
			return `APPROVAL_UNSUPPORTED: provider for ${cmd.sessionId} does not accept approval decisions`;
		}
		try {
			await handle.respondToApproval({
				sessionId: cmd.sessionId,
				runId: cmd.runId,
				approvalId: cmd.approvalId,
				decision: cmd.decision,
				scope: cmd.scope,
				...(cmd.alwaysAllow ? { alwaysAllow: true } : {}),
				...(cmd.updatedInput ? { updatedInput: cmd.updatedInput } : {}),
			});
			return null;
		} catch (error) {
			return interactionError('APPROVAL_RESPONSE_FAILED', error);
		}
	}

	async function handleAnswerQuestion(cmd: AgentCommand): Promise<string | null> {
		if (cmd.cmd !== 'answer_question') return 'invalid answer_question command';
		const handle = await activeInteractionHandle(cmd.sessionId, cmd.runId);
		if (typeof handle === 'string') return handle;
		if (!handle.respondToQuestion) {
			return `QUESTION_UNSUPPORTED: provider for ${cmd.sessionId} does not accept question answers`;
		}
		try {
			await handle.respondToQuestion({
				sessionId: cmd.sessionId,
				runId: cmd.runId,
				questionId: cmd.questionId,
				answers: cmd.answers,
			});
			return null;
		} catch (error) {
			return interactionError('QUESTION_RESPONSE_FAILED', error);
		}
	}

	async function activeInteractionHandle(
		sessionId: string,
		runId: string,
	): Promise<ProviderHandle | string> {
		const starting = startingSessions.get(sessionId);
		if (starting) await starting;
		const handle = handles.get(sessionId);
		if (!handle) return `NO_SESSION: no active session for ${sessionId}`;
		if (!activeRunIdsBySession.get(sessionId)?.has(runId)) {
			return `INTERACTION_RUN_NOT_ACTIVE: run ${runId} is not active in session ${sessionId}`;
		}
		return handle;
	}

	function interactionError(fallbackCode: string, error: unknown): string {
		if (error instanceof ProviderInteractionError) return error.message;
		return `${fallbackCode}: ${errorMessage(error)}`;
	}

	function emitFailure(code: string, message: string): void {
		manager.emitAgentEvent({
			type: 'run.failed',
			runId: '',
			error: `${code}: ${message}`,
		});
	}

	function emitRunFailure(runId: string, sessionId: string, code: string, message: string): void {
		manager.emitAgentEvent({ type: 'run.started', runId, sessionId });
		manager.emitAgentEvent({
			type: 'run.failed',
			runId,
			error: `${code}: ${message}`,
		});
	}

	function errorMessage(err: unknown): string {
		return err instanceof Error ? err.message : String(err);
	}

	async function settleWithin<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
		let timeout: NodeJS.Timeout | undefined;
		try {
			return await Promise.race([
				task,
				new Promise<never>((_resolve, reject) => {
					timeout = setTimeout(
						() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)),
						timeoutMs,
					);
				}),
			]);
		} finally {
			if (timeout) clearTimeout(timeout);
		}
	}

	return {
		parse: parseCommandLine,
		manager,
		run,
		inFlight: (): number => inFlightPromises.size,
		drain: async (): Promise<void> => {
			while (inFlightPromises.size > 0) {
				await Promise.allSettled([...inFlightPromises]);
			}
			await output.drain();
		},
		emitControl,
	};
}

function jsonLine(value: unknown): string {
	return JSON.stringify(value) + '\n';
}

export function attachStdio(rl: RLInterface, options: RunOptions = {}): AttachedIpc {
	const ipc = createIpc(options);
	const onLine = (raw: string): void => {
		void ipc.run(raw).catch((err: unknown) => {
			const errOut = options.stderr ?? process.stderr;
			errOut.write(`dispatch error: ${err instanceof Error ? err.stack : String(err)}\n`);
		});
	};
	rl.on('line', onLine);
	return { ...ipc, stopTracking: (): void => void rl.off('line', onLine) };
}

export async function runCli(options: RunOptions = {}): Promise<number> {
	registerClaudeProvider();
	const idleMs = options.idleTimeoutMs ?? null;
	const exitFn =
		options.exit ??
		((code: number): void => {
			process.exitCode = code;
		});

	const stdout: OutputSink = options.stdout ?? process.stdout;
	const stderr: OutputSink = options.stderr ?? process.stderr;
	const stdin: NodeJS.ReadableStream = options.stdin ?? process.stdin;

	const capabilities = await resolveProviderCapabilities(options.capabilityProbe);
	const rl = createInterface({ input: stdin, crlfDelay: Infinity });
	const ipc = createIpc({
		stdout,
		stderr,
		...(options.capabilityProbe ? { capabilityProbe: options.capabilityProbe } : {}),
	});
	let activeTimer: NodeJS.Timeout | null = null;
	let heartbeatTimer: NodeJS.Timeout | null = null;
	let closing = false;
	let dispatchChain: Promise<void> = Promise.resolve();
	ipc.emitControl(bridgeReadyFrame(capabilities));
	heartbeatTimer = setInterval(() => {
		ipc.emitControl(bridgeHeartbeatFrame());
	}, BRIDGE_HEARTBEAT_INTERVAL_MS);
	heartbeatTimer.unref();

	const finish = async (): Promise<void> => {
		if (closing) return;
		closing = true;
		if (activeTimer) {
			clearTimeout(activeTimer);
			activeTimer = null;
		}
		if (heartbeatTimer) {
			clearInterval(heartbeatTimer);
			heartbeatTimer = null;
		}
		await dispatchChain;
		await ipc.drain();
		exitFn(0);
	};

	const armIdle = (): void => {
		if (idleMs === null) return;
		if (closing) return;
		if (activeTimer) clearTimeout(activeTimer);
		activeTimer = setTimeout(() => {
			void finish();
		}, idleMs);
	};

	rl.on('line', (raw) => {
		armIdle();
		const previous = dispatchChain;
		dispatchChain = (async (): Promise<void> => {
			try {
				await previous;
			} catch {}
			await ipc.run(raw);
		})();
		dispatchChain.catch((err: unknown) => {
			stderr.write(`dispatch error: ${err instanceof Error ? err.stack : String(err)}\n`);
		});
	});

	armIdle();
	rl.on('close', () => {
		void finish();
	});

	return new Promise<number>(() => {});
}

function isMainEntrypoint(): boolean {
	if (typeof process.argv[1] !== 'string') return false;
	try {
		return fileURLToPath(import.meta.url) === process.argv[1];
	} catch {
		return false;
	}
}

if (isMainEntrypoint()) {
	void runCli().catch((err: unknown) => {
		process.stderr.write(`FATAL: ${err instanceof Error ? err.stack : String(err)}\n`);
		process.exit(1);
	});
}
