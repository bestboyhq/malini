import { PAUSED_FOR_EXIT_ERROR } from '$contract/agent-state-machine';
import { CHAT_AGENT_EVENT_CHANNEL } from '$contract/events';
import type { MaliniDatabase } from '$main/db/driver';
import type { EventBus } from '$main/events';
import { getCheckpointForRun } from '../checkpoints.repository';
import { getRunChange } from '../changes.repository';
import { appendEvent, type AgentEventEnvelope } from '../events.repository';
import {
	abortInteractionDispatch,
	finalizeInteractionResponse,
	prepareInteractionResponse,
	recordPendingInteraction,
	type InteractionRecordOutcome,
} from '../interactions.repository';
import { matchPermissionRule } from '../permissions.repository';
import {
	activeRunWorkstreamIdentity,
	finalizeRunLifecycle,
	listOpenRunIds,
	listOpenRuns,
} from '../runs.repository';
import { setProviderSessionId, setSessionStatus, type SessionStatus } from '../sessions.repository';
import { get, nowIso8601 } from '$main/db/rows';
import { normalizeRememberablePermission, type NormalizedPermission } from '../permissions.service';
import {
	camelEnvelopeJson,
	terminalizeRunsAfterBridgeLoss,
	type AgentRunLeases,
	type Lease,
	type SyntheticEventEnvelope,
} from './lifecycle';
import {
	eventRunId,
	eventSessionId,
	eventToPersistable,
	isEphemeralEvent,
	isTerminalEvent,
	type BridgeEvent,
} from './protocol';
import {
	persistedBridgeSession,
	persistedBridgeSessions,
	registerPersistedBridgeSession,
} from './sessions';
import {
	backoffForAttempt,
	BridgeSupervisor,
	sleep,
	waitUntil,
	type BridgeSupervisorConfig,
} from './supervisor';

export type RunFinishedReason =
	'terminal' | 'bridge-interrupted' | 'reset' | 'app-exit' | 'not-delivered';

export interface RunFinishedInput {
	readonly sessionId: string;
	readonly runId: string;
	readonly workstreamId: string;
	readonly reason: RunFinishedReason;
}

export interface BridgeRuntimeHooks {
	readonly onRunFinished?: (input: RunFinishedInput) => Promise<void> | void;
}

export interface BridgeRuntimeDeps {
	readonly db: MaliniDatabase;
	readonly events: EventBus;
	readonly appDataRoot: string;
	readonly supervisorConfig: BridgeSupervisorConfig;
	readonly leases: AgentRunLeases;
	readonly hooks?: BridgeRuntimeHooks;
	readonly log?: (line: string) => void;
}

export type LiveEventEnvelope = AgentEventEnvelope & { ephemeral?: true };

interface ResolvedEnvelope {
	sessionId: string;
	runId: string;
	seq: number;
	ephemeral: boolean;
	event: BridgeEvent;
}

export class SessionCorrelator {
	private readonly runToSession = new Map<string, string>();
	private readonly nextSeq = new Map<string, number>();

	resolve(event: BridgeEvent): ResolvedEnvelope | null {
		const selfSession = eventSessionId(event);
		const runId = eventRunId(event);
		let sessionId: string;
		if (selfSession !== null) {
			if (runId !== null) this.runToSession.set(runId, selfSession);
			sessionId = selfSession;
		} else {
			if (runId === null) return null;
			const known = this.runToSession.get(runId);
			if (known === undefined) return null;
			sessionId = known;
		}
		const ephemeral = isEphemeralEvent(event);
		let seq = -1;
		if (!ephemeral) {
			seq = this.nextSeq.get(sessionId) ?? 1;
			this.nextSeq.set(sessionId, seq + 1);
		}
		return { sessionId, runId: runId ?? '', seq, ephemeral, event };
	}
}

export function envelopeWithSeq(resolved: ResolvedEnvelope, seq: number): LiveEventEnvelope {
	const envelope: LiveEventEnvelope = {
		sessionId: resolved.sessionId,
		runId: resolved.runId,
		seq,
		event: { ...resolved.event },
	};
	return resolved.ephemeral ? { ...envelope, ephemeral: true } : envelope;
}

interface RecordedBridgeInteraction {
	outcome: InteractionRecordOutcome;
	normalizedPermission: NormalizedPermission | null;
}

export function recordBridgeInteractionRequest(
	db: MaliniDatabase,
	event: BridgeEvent,
): RecordedBridgeInteraction | null {
	let kind: 'approval' | 'question';
	let requestId: string;
	let permission: unknown;
	if (event.type === 'approval.requested') {
		kind = 'approval';
		requestId = event.approvalId;
		permission = event.permission;
	} else if (event.type === 'question.requested') {
		kind = 'question';
		requestId = event.questionId;
		permission = undefined;
	} else {
		return null;
	}
	const { sessionId, runId } = event;
	const requestPayload = eventToPersistable(event).payload;
	let normalizedPermission: NormalizedPermission | null = null;
	if (permission !== undefined) {
		const identity = activeRunWorkstreamIdentity(db, sessionId, runId);
		if (!identity) {
			throw new Error(`interaction \`${requestId}\` belongs to a stale session/run correlation`);
		}
		try {
			normalizedPermission = normalizeRememberablePermission(permission, identity.path);
		} catch {
			normalizedPermission = null;
		}
	}
	const outcome = recordPendingInteraction(db, {
		kind,
		sessionId,
		runId,
		requestId,
		requestPayload,
		permission: permission === undefined ? null : permission,
		permissionFingerprint: normalizedPermission?.fingerprint ?? null,
		requestedAt: nowIso8601(),
	});
	return { outcome, normalizedPermission };
}

function suppressed(outcome: InteractionRecordOutcome): boolean {
	return outcome === 'dispatching' || outcome === 'resolved' || outcome === 'closed';
}

export async function tryAutoApprove(
	db: MaliniDatabase,
	event: BridgeEvent,
	resolveSupervisor: () => Promise<BridgeSupervisor>,
	log: (line: string) => void,
): Promise<boolean> {
	if (event.type !== 'approval.requested' || event.permission === undefined) return false;
	const { sessionId, runId, approvalId, permission } = event;
	let recorded: RecordedBridgeInteraction | null;
	try {
		recorded = recordBridgeInteractionRequest(db, event);
	} catch (error) {
		log(`agent: could not correlate approval \`${approvalId}\` for auto-match: ${describe(error)}`);
		return false;
	}
	if (recorded === null) return false;
	if (suppressed(recorded.outcome)) return true;
	const normalized = recorded.normalizedPermission;
	if (normalized === null) return false;
	const identity = activeRunWorkstreamIdentity(db, sessionId, runId);
	if (!identity) return false;
	let rule;
	try {
		rule = matchPermissionRule(db, identity.workstreamId, sessionId, normalized.fingerprint);
	} catch (error) {
		log(`agent: could not match remembered permission for \`${approvalId}\`: ${describe(error)}`);
		return false;
	}
	if (!rule) return false;
	const response = { decision: 'allow', scope: rule.scope, permission };
	try {
		const outcome = prepareInteractionResponse(db, {
			kind: 'approval',
			sessionId,
			runId,
			requestId: approvalId,
			suppliedPermission: permission,
			intendedResponse: response,
		});
		if (outcome === 'already_resolved') return true;
	} catch (error) {
		log(
			`agent: remembered approval \`${approvalId}\` could not enter dispatch: ${describe(error)}`,
		);
		return false;
	}
	let supervisor: BridgeSupervisor;
	try {
		supervisor = await resolveSupervisor();
	} catch (error) {
		abortInteractionDispatch(db, 'approval', sessionId, runId, approvalId, response);
		log(
			`agent: remembered approval \`${approvalId}\` bridge unavailable; showing prompt: ${describe(error)}`,
		);
		return false;
	}
	try {
		await supervisor.sendCommand({
			cmd: 'approve',
			id: supervisor.nextCommandId(),
			sessionId,
			runId,
			approvalId,
			decision: 'allow',
			scope: rule.scope,
		});
	} catch (error) {
		abortInteractionDispatch(db, 'approval', sessionId, runId, approvalId, response);
		log(
			`agent: remembered approval \`${approvalId}\` was not acknowledged; showing prompt: ${describe(error)}`,
		);
		return false;
	}
	try {
		finalizeInteractionResponse(db, {
			kind: 'approval',
			sessionId,
			runId,
			requestId: approvalId,
			intendedResponse: response,
			decision: 'allow',
			scope: rule.scope,
			source: 'auto',
			decidedAt: nowIso8601(),
			matchedRuleId: rule.id,
		});
	} catch (error) {
		log(
			`agent: bridge ACKed remembered approval \`${approvalId}\` but audit finalization failed: ${describe(error)}`,
		);
	}
	return true;
}

function durableSessionStatus(event: BridgeEvent): SessionStatus | null {
	switch (event.type) {
		case 'run.started':
			return 'running';
		case 'approval.requested':
		case 'question.requested':
			return 'waiting_for_approval';
		case 'run.completed':
			return 'completed';
		case 'run.failed':
			return 'failed';
		case 'session.state':
			return event.status === 'idle' || event.status === 'completed' || event.status === 'failed'
				? event.status
				: null;
		default:
			return null;
	}
}

export function pumpStep(
	correlator: SessionCorrelator,
	db: MaliniDatabase,
	event: BridgeEvent,
	log: (line: string) => void = defaultLog,
): LiveEventEnvelope | null {
	const resolved = correlator.resolve(event);
	if (resolved === null) return null;

	try {
		const recorded = recordBridgeInteractionRequest(db, resolved.event);
		if (recorded !== null && suppressed(recorded.outcome)) return null;
	} catch (error) {
		log(
			`agent: failed to persist provider interaction correlation for session \`${resolved.sessionId}\` run \`${resolved.runId}\`; dropping the request event: ${describe(error)}`,
		);
		return null;
	}

	if (resolved.event.type === 'session.state' && resolved.event.providerSessionId !== undefined) {
		try {
			setProviderSessionId(db, resolved.sessionId, resolved.event.providerSessionId);
		} catch (error) {
			log(
				`agent: failed to persist provider session id for \`${resolved.sessionId}\`: ${describe(error)}`,
			);
		}
	}

	if (resolved.ephemeral) return envelopeWithSeq(resolved, -1);

	const { kind, payload } = eventToPersistable(resolved.event);
	let persistedSeq: number;
	try {
		persistedSeq = appendEvent(db, resolved.sessionId, resolved.runId, kind, payload);
	} catch (error) {
		log(
			`agent: failed to persist \`${kind}\` event for session \`${resolved.sessionId}\` run \`${resolved.runId}\` - dropping it (not emitting) to avoid a permanent replay gap: ${describe(error)}`,
		);
		return null;
	}

	if (isTerminalEvent(resolved.event)) {
		const now = nowIso8601();
		try {
			if (resolved.event.type === 'run.completed') {
				finalizeRunLifecycle(
					db,
					resolved.sessionId,
					resolved.runId,
					'completed',
					resolved.event.summary,
					null,
					now,
				);
			} else {
				finalizeRunLifecycle(
					db,
					resolved.sessionId,
					resolved.runId,
					'failed',
					null,
					resolved.event.error,
					now,
				);
			}
		} catch (error) {
			log(
				`agent: failed to finalize terminal run \`${resolved.runId}\` for session \`${resolved.sessionId}\`: ${describe(error)}`,
			);
		}
	} else {
		const status = durableSessionStatus(resolved.event);
		if (status !== null) {
			try {
				setSessionStatus(db, resolved.sessionId, status);
			} catch {}
		}
	}
	return envelopeWithSeq(resolved, persistedSeq);
}

interface BridgeRecoveryReport {
	terminalizedRuns: number;
	registeredSessions: number;
	registrationFailures: Map<string, string>;
}

interface TerminalCapture {
	runId: string;
	sessionId: string;
	workstreamId: string;
	lease: Lease;
}

const TERMINAL_CAPTURE_STOP_BUDGET_MS = 10_000;

export class BridgeRuntime {
	private readonly db: MaliniDatabase;
	private readonly events: EventBus;
	private readonly appDataRoot: string;
	private readonly supervisorConfig: BridgeSupervisorConfig;
	private readonly leases: AgentRunLeases;
	private readonly hooks: BridgeRuntimeHooks;
	private readonly log: (line: string) => void;
	private supervisor: BridgeSupervisor | null = null;
	private startFailure: string | null = null;
	private restartGate: Promise<BridgeSupervisor> | null = null;
	private restartAttempt = 0;
	private eventGeneration = 0;
	private readonly registeredSessions = new Set<string>();
	private readonly recoveryFailures = new Map<string, string>();
	private readonly pumps = new Map<number, Promise<void>>();
	private readonly terminalCaptures = new Set<Promise<void>>();
	private readonly pausing = new Set<string>();
	private stopped = false;

	constructor(deps: BridgeRuntimeDeps) {
		this.db = deps.db;
		this.events = deps.events;
		this.appDataRoot = deps.appDataRoot;
		this.supervisorConfig = deps.supervisorConfig;
		this.leases = deps.leases;
		this.hooks = deps.hooks ?? {};
		this.log = deps.log ?? defaultLog;
	}

	async start(): Promise<boolean> {
		try {
			const supervisor = await BridgeSupervisor.spawn(this.supervisorConfig);
			this.adopt(supervisor, this.eventGeneration);
			this.startFailure = null;
			return true;
		} catch (error) {
			this.startFailure = describe(error);
			this.log(`agent: bridge start failed: ${this.startFailure}`);
			return false;
		}
	}

	async pauseOpenRuns(timeoutMs: number): Promise<void> {
		if (this.stopped) return;
		this.stopped = true;
		const supervisor = this.supervisor;
		if (!supervisor?.isHealthy()) return;
		let open: Array<{ id: string; sessionId: string }>;
		try {
			open = listOpenRuns(this.db);
		} catch (error) {
			this.log(`agent: could not list the runs to pause: ${describe(error)}`);
			return;
		}
		for (const { id } of open) this.pausing.add(id);
		await Promise.all(
			open.map(({ id, sessionId }) =>
				supervisor
					.sendCommand({ cmd: 'cancel_run', id: supervisor.nextCommandId(), sessionId, runId: id })
					.catch((error: unknown) =>
						this.log(`agent: could not pause run \`${id}\`: ${describe(error)}`),
					),
			),
		);
		await waitUntil(
			() => !listOpenRunIds(this.db).some((runId) => this.pausing.has(runId)),
			timeoutMs,
		);
	}

	async stop(): Promise<void> {
		this.stopped = true;
		const supervisor = this.supervisor;
		this.supervisor = null;
		this.eventGeneration += 1;
		if (supervisor)
			await supervisor
				.kill()
				.catch((error) => this.log(`agent: bridge stop failed: ${describe(error)}`));
		await Promise.race([
			Promise.all(this.terminalCaptures),
			new Promise((resolve) => setTimeout(resolve, TERMINAL_CAPTURE_STOP_BUDGET_MS).unref()),
		]);
	}

	current(): BridgeSupervisor {
		if (this.supervisor === null) {
			throw new Error(
				this.startFailure === null
					? 'agent bridge is not running'
					: `agent bridge is not running: ${this.startFailure}`,
			);
		}
		return this.supervisor;
	}

	currentIfRunning(): BridgeSupervisor | null {
		return this.supervisor;
	}

	isHealthy(): boolean {
		return this.supervisor?.isHealthy() ?? false;
	}

	markSessionRegistered(sessionId: string, supervisor: BridgeSupervisor): void {
		if (this.supervisor !== supervisor) return;
		this.registeredSessions.add(sessionId);
		this.recoveryFailures.delete(sessionId);
	}

	markSessionsClosed(sessionIds: readonly string[], supervisor: BridgeSupervisor): void {
		if (this.supervisor !== supervisor) return;
		for (const sessionId of sessionIds) {
			this.registeredSessions.delete(sessionId);
			this.recoveryFailures.delete(sessionId);
		}
	}

	async ensureSessionReady(sessionId: string): Promise<BridgeSupervisor> {
		const supervisor = await this.ensureReady();
		const failure = this.recoveryFailures.get(sessionId);
		if (failure !== undefined) {
			throw new Error(
				`agent session \`${sessionId}\` could not recover after the bridge restarted: ${failure}`,
			);
		}
		if (this.registeredSessions.has(sessionId)) return supervisor;
		const session = persistedBridgeSession(this.db, sessionId);
		if (!session) throw new Error(`agent session \`${sessionId}\` not found`);
		await registerPersistedBridgeSession(this.db, this.appDataRoot, supervisor, session);
		this.markSessionRegistered(sessionId, supervisor);
		return supervisor;
	}

	ensureReady(): Promise<BridgeSupervisor> {
		if (this.stopped)
			return Promise.reject(new Error('the agent bridge stopped because malini is closing'));
		if (this.supervisor?.isHealthy()) return Promise.resolve(this.supervisor);
		if (this.restartGate) return this.restartGate;
		this.restartGate = this.replaceChild().finally(() => {
			this.restartGate = null;
		});
		return this.restartGate;
	}

	private async replaceChild(): Promise<BridgeSupervisor> {
		const current = this.supervisor;
		if (current?.isHealthy()) return current;
		this.restartAttempt = Math.min(this.restartAttempt + 1, 255);
		const attempt = this.restartAttempt;
		let replacement: BridgeSupervisor;
		try {
			if (current) {
				replacement = await current.restartWithBackoff(attempt);
			} else {
				await sleep(backoffForAttempt(attempt));
				replacement = await BridgeSupervisor.spawn(this.supervisorConfig);
			}
		} catch (error) {
			throw new Error(`agent bridge restart failed: ${describe(error)}`);
		}

		this.eventGeneration += 1;
		const generation = this.eventGeneration;
		this.attachPump(replacement, generation);
		const sessionsToRestore = new Set(this.registeredSessions);
		let recovery: BridgeRecoveryReport;
		try {
			recovery = await this.reconcileReplacement(replacement, sessionsToRestore);
		} catch (error) {
			await replacement.kill().catch(() => undefined);
			throw error;
		}
		this.log(
			`agent: bridge replacement terminalized ${recovery.terminalizedRuns} run(s), re-registered ${recovery.registeredSessions} session(s), skipped ${recovery.registrationFailures.size} session(s)`,
		);
		this.supervisor = replacement;
		this.registeredSessions.clear();
		for (const sessionId of sessionsToRestore) {
			if (!recovery.registrationFailures.has(sessionId)) this.registeredSessions.add(sessionId);
		}
		this.recoveryFailures.clear();
		for (const [sessionId, error] of recovery.registrationFailures) {
			this.recoveryFailures.set(sessionId, error);
		}
		this.restartAttempt = 0;
		this.startFailure = null;
		return replacement;
	}

	private async reconcileReplacement(
		replacement: BridgeSupervisor,
		sessionIds: ReadonlySet<string>,
	): Promise<BridgeRecoveryReport> {
		const terminalRunIds = listOpenRunIds(this.db);
		const terminalizedRuns = terminalizeRunsAfterBridgeLoss(this.db, (envelope, seq) =>
			this.emitSynthetic(envelope, seq),
		);
		for (const runId of terminalRunIds) {
			await this.notifyRunFinished(runId, 'bridge-interrupted');
		}
		const report: BridgeRecoveryReport = {
			terminalizedRuns,
			registeredSessions: 0,
			registrationFailures: new Map(),
		};
		for (const session of persistedBridgeSessions(this.db, sessionIds)) {
			try {
				await registerPersistedBridgeSession(this.db, this.appDataRoot, replacement, session);
				report.registeredSessions += 1;
			} catch (error) {
				const message = describe(error);
				this.log(
					`agent: session \`${session.id}\` was not re-registered after bridge replacement: ${message}`,
				);
				report.registrationFailures.set(session.id, message);
			}
		}
		return report;
	}

	private adopt(supervisor: BridgeSupervisor, generation: number): void {
		this.supervisor = supervisor;
		this.attachPump(supervisor, generation);
	}

	emitSynthetic(envelope: SyntheticEventEnvelope, seq: number): void {
		this.events.emit(CHAT_AGENT_EVENT_CHANNEL, camelEnvelopeJson(envelope, seq));
	}

	async notifyRunFinished(runId: string, reason: RunFinishedReason): Promise<void> {
		const hook = this.hooks.onRunFinished;
		if (!hook) return;
		const identity = runIdentity(this.db, runId);
		if (!identity) return;
		try {
			await hook({
				sessionId: identity.sessionId,
				runId,
				workstreamId: identity.workstreamId,
				reason,
			});
		} catch (error) {
			this.log(
				`agent: failed to capture ${reason} run changes for \`${runId}\`: ${describe(error)}`,
			);
		}
	}

	private attachPump(supervisor: BridgeSupervisor, generation: number): void {
		const correlator = new SessionCorrelator();
		let chain: Promise<void> = Promise.resolve();
		const unsubscribe = supervisor.onEvent((event) => {
			if (this.eventGeneration !== generation) {
				unsubscribe();
				return;
			}
			const previous = chain;
			chain = this.pumpAfter(previous, correlator, generation, event);
			this.pumps.set(generation, chain);
		});
	}

	private async pumpAfter(
		previous: Promise<void>,
		correlator: SessionCorrelator,
		generation: number,
		event: BridgeEvent,
	): Promise<void> {
		await previous;
		try {
			await this.pumpOne(correlator, generation, pausedForExit(event, this.pausing));
		} catch (error) {
			this.log(`agent: event pump failed: ${describe(error)}`);
		}
	}

	async settlePump(): Promise<void> {
		await Promise.all([...this.pumps.values()]);
	}

	private async pumpOne(
		correlator: SessionCorrelator,
		generation: number,
		event: BridgeEvent,
	): Promise<void> {
		if (this.eventGeneration !== generation) return;
		const interactionSessionId = eventSessionId(event);
		const handled = await tryAutoApprove(
			this.db,
			event,
			() => {
				if (interactionSessionId === null) {
					return Promise.reject(new Error('approval event has no session correlation'));
				}
				return this.ensureSessionReady(interactionSessionId);
			},
			this.log,
		);
		if (handled) return;
		const capture = isTerminalEvent(event) ? this.acquireTerminalCapture(event.runId) : null;
		const envelope = pumpStep(correlator, this.db, event, this.log);
		if (envelope === null) {
			capture?.lease.release();
			return;
		}
		this.events.emit(CHAT_AGENT_EVENT_CHANNEL, envelope);
		if (capture) {
			const hook = this.hooks.onRunFinished;
			const captured = (async () => {
				try {
					await hook?.({
						sessionId: capture.sessionId,
						runId: capture.runId,
						workstreamId: capture.workstreamId,
						reason: 'terminal',
					});
				} catch (error) {
					this.log(
						`agent: failed to capture terminal changes for run \`${capture.runId}\`: ${describe(error)}`,
					);
				} finally {
					capture.lease.release();
				}
			})();
			this.terminalCaptures.add(captured);
			void captured.finally(() => this.terminalCaptures.delete(captured));
		}
	}

	private acquireTerminalCapture(runId: string): TerminalCapture | null {
		if (!this.hooks.onRunFinished) return null;
		try {
			if (getRunChange(this.db, runId) !== null) return null;
		} catch (error) {
			this.log(
				`agent: could not check existing terminal changes for \`${runId}\`: ${describe(error)}`,
			);
			return null;
		}
		let checkpoint;
		try {
			checkpoint = getCheckpointForRun(this.db, runId);
		} catch (error) {
			this.log(
				`agent: could not resolve terminal capture context for \`${runId}\`: ${describe(error)}`,
			);
			return null;
		}
		if (!checkpoint) return null;
		try {
			const lease = this.leases.acquireRunChangeCapture(checkpoint.workstreamId);
			return {
				runId,
				sessionId: checkpoint.sessionId,
				workstreamId: checkpoint.workstreamId,
				lease,
			};
		} catch (error) {
			this.log(
				`agent: terminal change capture lease was unavailable for \`${runId}\`, so this run has no snapshot: ${describe(error)}`,
			);
			return null;
		}
	}

	get wasStopped(): boolean {
		return this.stopped;
	}
}

function pausedForExit(event: BridgeEvent, pausing: ReadonlySet<string>): BridgeEvent {
	return event.type === 'run.failed' && pausing.has(event.runId)
		? { ...event, error: PAUSED_FOR_EXIT_ERROR }
		: event;
}

function runIdentity(
	db: MaliniDatabase,
	runId: string,
): { sessionId: string; workstreamId: string } | null {
	const row = get<{ session_id: string; workstream_id: string }>(
		db,
		`SELECT r.session_id, s.workstream_id FROM agent_runs r
		 JOIN agent_sessions s ON s.id = r.session_id WHERE r.id = ?`,
		runId,
	);
	return row ? { sessionId: row.session_id, workstreamId: row.workstream_id } : null;
}

function defaultLog(line: string): void {
	console.error(line);
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
