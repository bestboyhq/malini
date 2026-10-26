import {
	BRIDGE_CONTRACT_NAME,
	BRIDGE_HEARTBEAT_TIMEOUT_MS,
	BRIDGE_MAX_DIAGNOSTIC_BYTES,
	BRIDGE_MAX_FRAME_BYTES,
	BRIDGE_PROTOCOL_VERSION,
	BRIDGE_READY_TIMEOUT_MS,
	commandAcknowledgementTimeoutMs,
	decodeBridgeEvent,
	decodeControlFrame,
	readyFrameMismatch,
	validateCapabilities,
	type AgentMcpServerListing,
	type AgentMcpServerStatus,
	type BridgeAgentRequest,
	type BridgeCommand,
	type BridgeMcpServerTarget,
	type BridgeControlFrame,
	type BridgeEvent,
	type ProviderCapability,
} from './protocol';
import type { AutomaticJob } from '$lib/jobs/jobs.platform';
import type { SkillRecord, TurnedOffSkills } from '$contract/skills';
import { killProcessGroup, processGroupIsAlive } from '$main/process/process-group';
import { IdSequence } from '../id-sequence';
import type { BridgeProcess, BridgeProcessFactory, BridgeSpawnSpec } from './process';

const BRIDGE_TERMINATION_GRACE_MS = 2_000;
const BRIDGE_FORCE_KILL_SETTLE_MS = 500;
const READY_POLL_MS = 10;
const TERMINATION_POLL_MS = 20;

export type SupervisorErrorKind =
	| 'spawn_failed'
	| 'already_running'
	| 'not_running'
	| 'io'
	| 'serde'
	| 'db'
	| 'pid_missing'
	| 'channel_closed'
	| 'protocol'
	| 'stopped';

export class SupervisorError extends Error {
	override readonly name = 'SupervisorError';
	readonly kind: SupervisorErrorKind;
	readonly detail: string;

	constructor(kind: SupervisorErrorKind, detail = '') {
		super(SupervisorError.describe(kind, detail));
		this.kind = kind;
		this.detail = detail;
	}

	static describe(kind: SupervisorErrorKind, detail: string): string {
		switch (kind) {
			case 'spawn_failed':
				return `spawn failed: ${detail}`;
			case 'already_running':
				return 'supervisor already running a bridge';
			case 'not_running':
				return 'bridge not running';
			case 'io':
				return `io error: ${detail}`;
			case 'serde':
				return `serde error: ${detail}`;
			case 'db':
				return `db error: ${detail}`;
			case 'pid_missing':
				return 'child pid missing';
			case 'channel_closed':
				return 'channel closed';
			case 'protocol':
				return `bridge protocol error: ${detail}`;
			case 'stopped':
				return `bridge stopped ${detail}`;
		}
	}
}

export type BridgeHealth =
	| { state: 'pending' }
	| { state: 'healthy'; pid: number; upMs: number }
	| { state: 'crashed'; lastExit: number }
	| { state: 'killed' };

export interface BridgeSupervisorConfig {
	readonly processFactory: BridgeProcessFactory;
	readonly spawn: BridgeSpawnSpec;
	readonly protocolRequired?: boolean;
	readonly now?: () => number;
	readonly log?: (line: string) => void;
}

type AckResult = { ok: true } | { ok: false; kind: SupervisorErrorKind; error: string };

interface PendingAck {
	resolve(result: AckResult): void;
}

export function backoffForAttempt(attempt: number): number {
	const n = Math.max(1, Math.floor(attempt));
	const shift = Math.min(n - 1, 5);
	return Math.min(2 ** shift, 30) * 1_000;
}

export function appendDiagnosticTail(tail: string, line: string): string {
	let next = `${tail}${line}\n`;
	const excess = Buffer.byteLength(next) - BRIDGE_MAX_DIAGNOSTIC_BYTES;
	if (excess > 0) {
		const buffer = Buffer.from(next);
		next = buffer.subarray(buffer.length - BRIDGE_MAX_DIAGNOSTIC_BYTES).toString('utf8');
		next = next.replace(/^�+/, '');
	}
	return next;
}

export function diagnosticExcerpt(value: string): string {
	const EXCERPT_CHARS = 512;
	const chars = [...value];
	if (chars.length <= EXCERPT_CHARS) return value.trim();
	return chars
		.slice(chars.length - EXCERPT_CHARS)
		.join('')
		.trim();
}

export class BoundedLineSplitter {
	private pending: Buffer[] = [];
	private pendingBytes = 0;
	private tooLarge = false;

	constructor(
		private readonly maxBytes: number,
		private readonly onLine: (line: string) => void,
		private readonly onTooLarge: () => void,
	) {}

	push(chunk: Buffer): void {
		let offset = 0;
		while (offset < chunk.length) {
			const newline = chunk.indexOf(0x0a, offset);
			const end = newline === -1 ? chunk.length : newline + 1;
			const slice = chunk.subarray(offset, end);
			if (!this.tooLarge) {
				if (this.pendingBytes + slice.length > this.maxBytes) {
					this.tooLarge = true;
					this.pending = [];
					this.pendingBytes = 0;
				} else {
					this.pending.push(slice);
					this.pendingBytes += slice.length;
				}
			}
			offset = end;
			if (newline !== -1) this.flushLine();
		}
	}

	end(): void {
		if (this.pendingBytes > 0 || this.tooLarge) this.flushLine();
	}

	private flushLine(): void {
		if (this.tooLarge) {
			this.tooLarge = false;
			this.onTooLarge();
			return;
		}
		const line = Buffer.concat(this.pending, this.pendingBytes).toString('utf8');
		this.pending = [];
		this.pendingBytes = 0;
		this.onLine(line.replace(/[\r\n]+$/, '').trim());
	}
}

export class BridgeSupervisor {
	private readonly config: BridgeSupervisorConfig;
	private readonly protocolRequired: boolean;
	private readonly commandIds = new IdSequence();
	private readonly now: () => number;
	private readonly log: (line: string) => void;
	private child: BridgeProcess | null;
	private pidValue: number;
	private ready: boolean;
	private capabilities: ProviderCapability[] = [];
	private capabilitiesRevision = 0;
	private lastHeartbeatMs: number;
	private protocolErrorText: string | null = null;
	private stderrTail = '';
	private readonly pendingAcks = new Map<string, PendingAck>();
	private readonly suggestedTitles = new Map<string, string>();
	private readonly chosenPicks = new Map<string, number>();
	private readonly listedSkills = new Map<string, SkillRecord[]>();
	private readonly mcpAuthorizations = new Map<string, string | null>();
	private readonly mcpSwitches = new Map<string, string[]>();
	private readonly mcpServerListeners = new Set<(server: AgentMcpServerStatus) => void>();
	private readonly mcpListingListeners = new Set<(listing: AgentMcpServerListing) => void>();
	private readonly eventListeners = new Set<(event: BridgeEvent) => void>();
	private readonly agentRequestListeners = new Set<(request: BridgeAgentRequest) => void>();
	private readonly startedAtMs: number;
	private restartAttempt = 0;
	private shuttingDown = false;

	private constructor(config: BridgeSupervisorConfig, child: BridgeProcess) {
		this.config = config;
		this.protocolRequired = config.protocolRequired ?? true;
		this.now = config.now ?? Date.now;
		this.log = config.log ?? ((line) => console.error(line));
		this.child = child;
		this.pidValue = child.pid;
		this.ready = !this.protocolRequired;
		this.startedAtMs = this.now();
		this.lastHeartbeatMs = this.protocolRequired ? 0 : this.startedAtMs;
	}

	static async spawn(config: BridgeSupervisorConfig): Promise<BridgeSupervisor> {
		let child: BridgeProcess;
		try {
			child = await config.processFactory.spawn(config.spawn);
		} catch (error) {
			throw new SupervisorError('spawn_failed', describe(error));
		}
		const supervisor = new BridgeSupervisor(config, child);
		supervisor.attach(child);
		if (!supervisor.protocolRequired) return supervisor;

		const deadline = supervisor.now() + BRIDGE_READY_TIMEOUT_MS;
		while (supervisor.now() < deadline) {
			if (supervisor.isHealthy()) return supervisor;
			if (supervisor.ready || supervisor.protocolErrorText !== null || !supervisor.childIsAlive()) {
				break;
			}
			await sleep(READY_POLL_MS);
		}
		const reason = supervisor.unavailableReason();
		await supervisor.kill().catch(() => undefined);
		throw new SupervisorError('protocol', reason);
	}

	private attach(child: BridgeProcess): void {
		const splitter = new BoundedLineSplitter(
			BRIDGE_MAX_FRAME_BYTES,
			(line) => this.processStdoutFrame(line),
			() =>
				this.recordProtocolError(
					`FRAME_TOO_LARGE: child stdout frame exceeds ${BRIDGE_MAX_FRAME_BYTES} bytes`,
				),
		);
		child.stdout.on('data', (chunk: Buffer | string) => {
			splitter.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
		});
		child.stdout.on('end', () => splitter.end());
		child.stdout.on('error', (error) => {
			this.recordProtocolError(`STDOUT_READ_FAILED: ${describe(error)}`);
		});
		if (child.stderr) {
			let partial = '';
			child.stderr.setEncoding('utf8');
			child.stderr.on('data', (chunk: string) => {
				partial += chunk;
				const lines = partial.split('\n');
				partial = lines.pop() ?? '';
				for (const line of lines) this.appendStderr(line.replace(/\r$/, ''));
			});
			child.stderr.on('end', () => {
				if (partial.length > 0) this.appendStderr(partial);
			});
			child.stderr.on('error', (error) => {
				this.stderrTail = appendDiagnosticTail(
					this.stderrTail,
					`stderr read failed: ${describe(error)}`,
				);
			});
		}
		child.stdin.on('error', () => {});
		child.onExit(() => this.noteChildGone());
	}

	private appendStderr(line: string): void {
		this.stderrTail = appendDiagnosticTail(this.stderrTail, line);
		this.log(`agent-bridge stderr: ${line}`);
	}

	private noteChildGone(): void {
		const previousPid = this.pidValue;
		this.pidValue = 0;
		this.child = null;
		if (previousPid !== 0) {
			this.failPendingAcks('protocol', 'bridge exited before command acknowledgement');
		}
	}

	private childIsAlive(): boolean {
		if (this.child === null) return false;
		if (this.child.exited()) {
			this.noteChildGone();
			return false;
		}
		return true;
	}

	private recordProtocolError(message: string): void {
		this.log(`agent-bridge protocol: ${message}`);
		this.protocolErrorText = message;
	}

	private failPendingAcks(kind: SupervisorErrorKind, message: string): void {
		const pending = [...this.pendingAcks.values()];
		this.pendingAcks.clear();
		for (const ack of pending) ack.resolve({ ok: false, kind, error: message });
	}

	private emitEvent(event: BridgeEvent): void {
		for (const listener of [...this.eventListeners]) {
			try {
				listener(event);
			} catch (error) {
				this.log(`agent-bridge event listener failed: ${describe(error)}`);
			}
		}
	}

	private processStdoutFrame(line: string): void {
		if (line.length === 0) return;
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch (error) {
			this.recordProtocolError(`BAD_FRAME: malformed child JSON: ${describe(error)}`);
			return;
		}
		const frameType = isRecord(value) ? value['type'] : undefined;
		if (typeof frameType === 'string' && frameType.startsWith('bridge.')) {
			const control = decodeControlFrame(value);
			if (!control.ok) {
				this.recordProtocolError(`BAD_CONTROL_FRAME: ${control.error}`);
				return;
			}
			this.processControl(control.value);
			return;
		}
		const runIdField = isRecord(value) ? value['runId'] : undefined;
		const runId = typeof runIdField === 'string' && runIdField.length > 0 ? runIdField : null;
		const event = decodeBridgeEvent(value);
		if (event.ok) {
			this.emitEvent(event.value);
			return;
		}
		const message = `BAD_EVENT_FRAME: ${event.error}`;
		this.recordProtocolError(message);
		if (runId !== null) this.emitEvent({ type: 'run.failed', runId, error: message });
	}

	private processControl(control: BridgeControlFrame): void {
		switch (control.type) {
			case 'bridge.ready': {
				const mismatch = readyFrameMismatch(control);
				if (mismatch !== null) {
					this.ready = false;
					this.recordProtocolError(mismatch);
					return;
				}
				if (control.pid === 0) {
					this.recordProtocolError('BAD_READY_FRAME: child pid is zero');
					return;
				}
				try {
					validateCapabilities(control.capabilities);
				} catch (error) {
					this.ready = false;
					this.recordProtocolError(`BAD_READY_FRAME: ${describe(error)}`);
					return;
				}
				this.capabilities = control.capabilities;
				this.capabilitiesRevision += 1;
				this.lastHeartbeatMs = this.now();
				this.ready = true;
				return;
			}
			case 'bridge.capabilities': {
				if (control.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
					this.recordProtocolError(
						`PROTOCOL_MISMATCH: capabilities v${control.protocolVersion}, expected v${BRIDGE_PROTOCOL_VERSION}`,
					);
					return;
				}
				if (!this.ready) {
					this.recordProtocolError(
						'CAPABILITIES_BEFORE_READY: child capabilities arrived before readiness',
					);
					return;
				}
				try {
					validateCapabilities(control.capabilities);
				} catch (error) {
					this.recordProtocolError(`BAD_CAPABILITIES_FRAME: ${describe(error)}`);
					return;
				}
				this.capabilities = control.capabilities;
				this.capabilitiesRevision += 1;
				return;
			}
			case 'bridge.heartbeat': {
				if (control.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
					this.recordProtocolError(
						`PROTOCOL_MISMATCH: heartbeat v${control.protocolVersion}, expected v${BRIDGE_PROTOCOL_VERSION}`,
					);
					return;
				}
				if (!this.ready) {
					this.recordProtocolError(
						'HEARTBEAT_BEFORE_READY: child heartbeat arrived before readiness',
					);
					return;
				}
				this.lastHeartbeatMs = this.now();
				return;
			}
			case 'bridge.command_ack': {
				const result: AckResult =
					control.protocolVersion !== BRIDGE_PROTOCOL_VERSION
						? {
								ok: false,
								kind: 'protocol',
								error: `PROTOCOL_MISMATCH: command ack v${control.protocolVersion}, expected v${BRIDGE_PROTOCOL_VERSION}`,
							}
						: control.accepted
							? { ok: true }
							: {
									ok: false,
									kind: 'protocol',
									error: control.error ?? `command ${control.id} was rejected`,
								};
				const pending = this.pendingAcks.get(control.id);
				if (pending) {
					this.pendingAcks.delete(control.id);
					pending.resolve(result);
				}
				return;
			}
			case 'bridge.title': {
				if (control.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
					this.recordProtocolError(
						`PROTOCOL_MISMATCH: title v${control.protocolVersion}, expected v${BRIDGE_PROTOCOL_VERSION}`,
					);
					return;
				}
				if (this.pendingAcks.has(control.id)) this.suggestedTitles.set(control.id, control.title);
				return;
			}
			case 'bridge.choice': {
				if (control.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
					this.recordProtocolError(
						`PROTOCOL_MISMATCH: choice v${control.protocolVersion}, expected v${BRIDGE_PROTOCOL_VERSION}`,
					);
					return;
				}
				if (this.pendingAcks.has(control.id)) this.chosenPicks.set(control.id, control.pick);
				return;
			}
			case 'bridge.skills': {
				if (control.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
					this.recordProtocolError(
						`PROTOCOL_MISMATCH: skills v${control.protocolVersion}, expected v${BRIDGE_PROTOCOL_VERSION}`,
					);
					return;
				}
				if (this.pendingAcks.has(control.id)) this.listedSkills.set(control.id, control.skills);
				return;
			}
			case 'bridge.mcp_authorization': {
				if (control.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
					this.recordProtocolError(
						`PROTOCOL_MISMATCH: mcp authorization v${control.protocolVersion}, expected v${BRIDGE_PROTOCOL_VERSION}`,
					);
					return;
				}
				if (this.pendingAcks.has(control.id)) {
					this.mcpAuthorizations.set(control.id, control.authUrl ?? null);
				}
				return;
			}
			case 'bridge.mcp_servers': {
				if (control.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
					this.recordProtocolError(
						`PROTOCOL_MISMATCH: mcp servers v${control.protocolVersion}, expected v${BRIDGE_PROTOCOL_VERSION}`,
					);
					return;
				}
				const { cwd, servers, settled, error } = control;
				const listing = { cwd, servers, settled, ...(error === undefined ? {} : { error }) };
				for (const listener of [...this.mcpListingListeners]) {
					try {
						listener(listing);
					} catch (error) {
						this.log(`agent-bridge bridge.mcp_servers listener failed: ${describe(error)}`);
					}
				}
				return;
			}
			case 'bridge.mcp_switched': {
				if (control.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
					this.recordProtocolError(
						`PROTOCOL_MISMATCH: mcp switched v${control.protocolVersion}, expected v${BRIDGE_PROTOCOL_VERSION}`,
					);
					return;
				}
				if (this.pendingAcks.has(control.id)) this.mcpSwitches.set(control.id, control.folders);
				return;
			}
			case 'bridge.mcp_server': {
				if (control.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
					this.recordProtocolError(
						`PROTOCOL_MISMATCH: mcp server v${control.protocolVersion}, expected v${BRIDGE_PROTOCOL_VERSION}`,
					);
					return;
				}
				for (const listener of [...this.mcpServerListeners]) {
					try {
						listener(control.server);
					} catch (error) {
						this.log(`agent-bridge bridge.mcp_server listener failed: ${describe(error)}`);
					}
				}
				return;
			}
			case 'bridge.browser_request':
			case 'bridge.platform_request': {
				if (control.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
					this.recordProtocolError(
						`PROTOCOL_MISMATCH: ${control.type} v${control.protocolVersion}, expected v${BRIDGE_PROTOCOL_VERSION}`,
					);
					return;
				}
				for (const listener of [...this.agentRequestListeners]) {
					try {
						listener(control);
					} catch (error) {
						this.log(`agent-bridge ${control.type} listener failed: ${describe(error)}`);
					}
				}
				return;
			}
			case 'bridge.protocol_error': {
				const versionNote =
					control.protocolVersion === BRIDGE_PROTOCOL_VERSION
						? ''
						: ` (frame v${control.protocolVersion}; expected v${BRIDGE_PROTOCOL_VERSION})`;
				const sessionNote = control.sessionId === undefined ? '' : ` session=${control.sessionId}`;
				const failure = `${control.code}: ${control.message}${versionNote}${sessionNote}`;
				this.recordProtocolError(failure);
				if (control.id !== undefined) {
					const pending = this.pendingAcks.get(control.id);
					if (pending) {
						this.pendingAcks.delete(control.id);
						pending.resolve({ ok: false, kind: 'protocol', error: failure });
					}
				}
				if (control.runId !== undefined && control.runId.length > 0) {
					this.emitEvent({ type: 'run.failed', runId: control.runId, error: failure });
				}
				return;
			}
		}
	}

	onEvent(listener: (event: BridgeEvent) => void): () => void {
		this.eventListeners.add(listener);
		return () => {
			this.eventListeners.delete(listener);
		};
	}

	onAgentRequest(listener: (request: BridgeAgentRequest) => void): () => void {
		this.agentRequestListeners.add(listener);
		return () => {
			this.agentRequestListeners.delete(listener);
		};
	}

	onMcpServer(listener: (server: AgentMcpServerStatus) => void): () => void {
		this.mcpServerListeners.add(listener);
		return () => {
			this.mcpServerListeners.delete(listener);
		};
	}

	onMcpServers(listener: (listing: AgentMcpServerListing) => void): () => void {
		this.mcpListingListeners.add(listener);
		return () => {
			this.mcpListingListeners.delete(listener);
		};
	}

	private writeLine(line: string): void {
		const child = this.child;
		if (child === null) throw new SupervisorError('io', 'bridge stdin is closed');
		try {
			child.stdin.write(`${line}\n`);
		} catch (error) {
			throw new SupervisorError('io', describe(error));
		}
	}

	async sendCommand(command: BridgeCommand): Promise<void> {
		const correlationId = command.id;
		const timeoutMs = commandAcknowledgementTimeoutMs(command);
		const line = JSON.stringify(command);

		if (!this.protocolRequired) {
			this.writeLine(line);
			return;
		}
		if (!this.isHealthy()) throw new SupervisorError('protocol', this.unavailableReason());
		if (this.pendingAcks.has(correlationId)) {
			throw new SupervisorError(
				'protocol',
				`duplicate in-flight command correlation id \`${correlationId}\``,
			);
		}
		const ack = new Promise<AckResult>((resolve) => {
			this.pendingAcks.set(correlationId, { resolve });
		});
		try {
			this.writeLine(line);
		} catch (error) {
			this.pendingAcks.delete(correlationId);
			throw error;
		}
		let timer: NodeJS.Timeout | undefined;
		const timeout = new Promise<'timeout'>((resolve) => {
			timer = setTimeout(() => resolve('timeout'), timeoutMs);
		});
		let result: AckResult | 'timeout';
		try {
			result = await Promise.race([ack, timeout]);
		} finally {
			if (timer !== undefined) clearTimeout(timer);
		}
		if (result === 'timeout') {
			this.pendingAcks.delete(correlationId);
			throw new SupervisorError(
				'protocol',
				`command ${correlationId} was not acknowledged within ${timeoutMs}ms`,
			);
		}
		if (!result.ok) throw new SupervisorError(result.kind, result.error);
	}

	writeRawLine(line: string): void {
		this.writeLine(line);
	}

	nextCommandId(): string {
		return this.commandIds.next('cmd', this.now());
	}

	providerCapabilities(): ProviderCapability[] {
		return this.capabilities.map((capability) => ({
			...capability,
			models: [...capability.models],
		}));
	}

	async refreshProviderCapabilities(): Promise<ProviderCapability[]> {
		const before = this.capabilitiesRevision;
		await this.sendCommand({ cmd: 'refresh_capabilities', id: this.nextCommandId() });
		if (this.capabilitiesRevision <= before) {
			throw new SupervisorError(
				'protocol',
				this.protocolErrorText ??
					'capability refresh was acknowledged without a validated bridge.capabilities frame',
			);
		}
		return this.providerCapabilities();
	}

	async suggestTitle(prompt: string, job: AutomaticJob): Promise<string> {
		const id = this.nextCommandId();
		try {
			await this.sendCommand({ cmd: 'suggest_title', id, prompt, ...job });
			const title = this.suggestedTitles.get(id);
			if (title === undefined) {
				throw new SupervisorError(
					'protocol',
					'title was acknowledged without a bridge.title frame',
				);
			}
			return title;
		} finally {
			this.suggestedTitles.delete(id);
		}
	}

	async choose(prompt: string, job: AutomaticJob, choices: number): Promise<number> {
		const id = this.nextCommandId();
		try {
			await this.sendCommand({ cmd: 'choose', id, prompt, ...job, choices });
			const pick = this.chosenPicks.get(id);
			if (pick === undefined) {
				throw new SupervisorError(
					'protocol',
					'choice was acknowledged without a bridge.choice frame',
				);
			}
			return pick;
		} finally {
			this.chosenPicks.delete(id);
		}
	}

	async listSkills(cwd: string, turnedOff: TurnedOffSkills): Promise<SkillRecord[]> {
		const id = this.nextCommandId();
		try {
			await this.sendCommand({ cmd: 'list_skills', id, cwd, turnedOff });
			const skills = this.listedSkills.get(id);
			if (skills === undefined) {
				throw new SupervisorError(
					'protocol',
					'skills were acknowledged without a bridge.skills frame',
				);
			}
			return skills;
		} finally {
			this.listedSkills.delete(id);
		}
	}

	refreshSessionStatus(sessionId: string): Promise<void> {
		return this.sendCommand({ cmd: 'refresh_session_status', id: this.nextCommandId(), sessionId });
	}

	watchMcpServers(cwd: string, restart = false): Promise<void> {
		return this.sendCommand({
			cmd: 'watch_mcp_servers',
			id: this.nextCommandId(),
			cwd,
			...(restart ? { restart } : {}),
		});
	}

	async switchMcpServer(
		serverName: string,
		on: boolean,
		folders: readonly string[],
	): Promise<string[]> {
		const id = this.nextCommandId();
		try {
			await this.sendCommand({ cmd: 'switch_mcp_server', id, serverName, on, folders });
			const switched = this.mcpSwitches.get(id);
			if (switched === undefined) {
				throw new SupervisorError(
					'protocol',
					'the switch was acknowledged without a bridge.mcp_switched frame',
				);
			}
			return switched;
		} finally {
			this.mcpSwitches.delete(id);
		}
	}

	async authorizeMcpServer(
		target: BridgeMcpServerTarget,
		serverName: string,
	): Promise<string | null> {
		const id = this.nextCommandId();
		try {
			await this.sendCommand({ cmd: 'authorize_mcp_server', id, serverName, ...target });
			const authUrl = this.mcpAuthorizations.get(id);
			if (authUrl === undefined) {
				throw new SupervisorError(
					'protocol',
					'the authorization was acknowledged without a bridge.mcp_authorization frame',
				);
			}
			return authUrl;
		} finally {
			this.mcpAuthorizations.delete(id);
		}
	}

	cancelMcpAuthorization(serverName: string): Promise<void> {
		return this.sendCommand({
			cmd: 'cancel_mcp_authorization',
			id: this.nextCommandId(),
			serverName,
		});
	}

	reconnectMcpServer(target: BridgeMcpServerTarget, serverName: string): Promise<void> {
		return this.sendCommand({
			cmd: 'reconnect_mcp_server',
			id: this.nextCommandId(),
			serverName,
			...target,
		});
	}

	async kill(): Promise<void> {
		this.shuttingDown = true;
		this.failPendingAcks('stopped', 'before command acknowledgement');
		const child = this.child;
		const pid = this.pidValue;
		if (child === null || pid === 0) {
			this.pidValue = 0;
			return;
		}
		let firstError: string | null = null;
		const signal = (name: 'SIGTERM' | 'SIGKILL'): void => {
			try {
				if (child.leadsProcessGroup) signalProcessGroup(pid, name);
				else child.kill(name);
			} catch (error) {
				firstError ??= describe(error);
			}
		};
		try {
			child.stdin.end();
		} catch {}
		signal('SIGTERM');
		if (!(await waitUntil(() => !this.groupAlive(child, pid), BRIDGE_TERMINATION_GRACE_MS))) {
			signal('SIGKILL');
			await waitUntil(() => !this.groupAlive(child, pid), BRIDGE_FORCE_KILL_SETTLE_MS);
		}
		const survived = this.groupAlive(child, pid);
		this.child = null;
		this.pidValue = 0;
		if (survived) {
			throw new SupervisorError(
				'io',
				firstError ?? `Bridge process group ${pid} remained alive after SIGKILL`,
			);
		}
		if (firstError !== null) throw new SupervisorError('io', firstError);
	}

	private groupAlive(child: BridgeProcess, pid: number): boolean {
		if (child.leadsProcessGroup) return bridgeProcessGroupIsAlive(pid);
		return !child.exited();
	}

	async restartWithBackoff(attempt: number): Promise<BridgeSupervisor> {
		await sleep(backoffForAttempt(attempt));
		await this.kill();
		this.restartAttempt = attempt;
		return BridgeSupervisor.spawn(this.config);
	}

	isHealthy(): boolean {
		if (this.shuttingDown) return false;
		if (this.protocolRequired && !this.ready) return false;
		const heartbeatFresh = this.protocolRequired
			? this.now() - this.lastHeartbeatMs <= BRIDGE_HEARTBEAT_TIMEOUT_MS
			: true;
		return this.childIsAlive() && heartbeatFresh;
	}

	health(): BridgeHealth {
		if (this.shuttingDown) return { state: 'killed' };
		if (!this.isHealthy()) return { state: 'crashed', lastExit: this.restartAttempt };
		if (this.pidValue !== 0) {
			return {
				state: 'healthy',
				pid: this.pidValue,
				upMs: Math.max(0, this.now() - this.startedAtMs),
			};
		}
		return { state: 'pending' };
	}

	lastHeartbeat(): number {
		return this.lastHeartbeatMs;
	}

	unavailableReason(): string {
		if (this.protocolErrorText !== null) return this.protocolErrorText;
		if (!this.childIsAlive()) {
			const stderr = this.stderrTail;
			if (stderr.trim().length > 0) {
				return `agent bridge exited; stderr: ${diagnosticExcerpt(stderr)}`;
			}
			return 'agent bridge process exited';
		}
		if (this.protocolRequired && !this.ready) {
			return `agent bridge did not send ${BRIDGE_CONTRACT_NAME} v${BRIDGE_PROTOCOL_VERSION} readiness within ${BRIDGE_READY_TIMEOUT_MS}ms`;
		}
		if (this.protocolRequired) {
			const age = this.now() - this.lastHeartbeatMs;
			if (age > BRIDGE_HEARTBEAT_TIMEOUT_MS) {
				return `agent bridge heartbeat is stale (${age}ms; timeout ${BRIDGE_HEARTBEAT_TIMEOUT_MS}ms)`;
			}
		}
		return 'agent bridge is not running';
	}

	protocolError(): string | null {
		return this.protocolErrorText;
	}

	pid(): number | null {
		return this.pidValue === 0 ? null : this.pidValue;
	}

	stderrExcerpt(): string {
		return diagnosticExcerpt(this.stderrTail);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function signalProcessGroup(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void {
	killProcessGroup(
		pid,
		signal,
		(error) => `Could not signal bridge process group ${pid} with ${signal}: ${describe(error)}`,
	);
}

function bridgeProcessGroupIsAlive(pid: number): boolean {
	return pid > 0 && processGroupIsAlive(pid);
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitUntil(condition: () => boolean, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (condition()) return true;
		await sleep(TERMINATION_POLL_MS);
	}
	return condition();
}
