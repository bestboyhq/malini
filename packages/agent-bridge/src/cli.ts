import { createInterface, type Interface as RLInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
	bridgeCapabilitiesFrame,
	bridgeCommandAckFrame,
	bridgeHeartbeatFrame,
	bridgeProtocolErrorFrame,
	bridgeReadyFrame,
	parseCommandLine,
	type AgentCommand,
	type BridgeControlFrame,
	type ProviderCapability,
} from './protocol.js';
import { probeClaudeCode, unknownCapability } from './claude/capabilities.js';
import { registerClaudeProvider } from './claude/index.js';
import { BRIDGE_HEARTBEAT_INTERVAL_MS } from './generated/protocol-contract.js';
import { sanitizePublicError } from './error-sanitizer.js';
import { SessionManager, UnknownSessionError } from './session-manager.js';
import { defaultProviderRegistry } from './providers/registry.js';
import type { ProviderContext, ProviderHandle } from './providers/types.js';
import { ProviderInteractionError } from './provider-interactions.js';
import type { AgentEvent } from './types.js';

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
	closeSessionTimeoutMs?: number;
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
		default:
			return frame;
	}
}

function sanitizeEventErrors(event: AgentEvent): AgentEvent {
	switch (event.type) {
		case 'run.failed':
		case 'tool.failed':
			return { ...event, error: sanitizePublicError(event.error) };
		case 'mcp.status':
			return {
				...event,
				servers: event.servers.map((server) =>
					server.error === undefined
						? server
						: { ...server, error: sanitizePublicError(server.error) },
				),
			};
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
	const startingSessions = new Map<string, Promise<void>>();
	const inFlightPromises = new Set<Promise<void>>();
	const activeRunSessions = new Set<string>();
	const activeRunIdsBySession = new Map<string, Set<string>>();
	const closeSessionTimeoutMs = options.closeSessionTimeoutMs ?? 3_500;
	const stdout = options.stdout ?? process.stdout;
	const output = new BridgeOutputWriter(stdout);

	manager.onAgentEvent((ev) => output.writeEvent(ev));

	function emitControl(frame: BridgeControlFrame): void {
		output.writeControl(frame);
	}

	async function run(line: string): Promise<void> {
		const parsed = parseCommandLine(line);
		if (!parsed.ok) {
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
			case 'refresh_mcp_status': {
				const error = await handleRefreshMcpStatus(cmd);
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
			await handle.sendPrompt(
				cmd.prompt,
				cmd.runId,
				cmd.profile,
				cmd.resumeAt,
				cmd.freshConversation,
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

	async function handleCancelRun(cmd: AgentCommand): Promise<string | null> {
		if (cmd.cmd !== 'cancel_run') return 'invalid cancel_run command';
		const handle = handles.get(cmd.sessionId);
		if (!handle) {
			emitFailure('NO_SESSION', `no active session for ${cmd.sessionId}`);
			return `NO_SESSION: no active session for ${cmd.sessionId}`;
		}
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
		activeRunSessions.delete(cmd.sessionId);
		activeRunIdsBySession.delete(cmd.sessionId);
		return null;
	}

	async function handleRefreshMcpStatus(cmd: AgentCommand): Promise<string | null> {
		if (cmd.cmd !== 'refresh_mcp_status') return 'invalid refresh_mcp_status command';
		const starting = startingSessions.get(cmd.sessionId);
		if (starting) await starting;
		const handle = handles.get(cmd.sessionId);
		if (!handle) return `NO_SESSION: no active session for ${cmd.sessionId}`;
		if (!handle.refreshMcpStatus) {
			return `MCP_STATUS_UNSUPPORTED: provider for ${cmd.sessionId} does not expose MCP status`;
		}
		try {
			await handle.refreshMcpStatus(cmd.runId);
			return null;
		} catch (error) {
			return `MCP_STATUS_REFRESH_FAILED: ${errorMessage(error)}`;
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
