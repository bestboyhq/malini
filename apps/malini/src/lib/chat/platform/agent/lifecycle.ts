import { BRIDGE_INTERRUPTED_ERROR, ORPHAN_INTERRUPTED_ERROR } from '$contract/agent-state-machine';
import { closeTerminalInteractions } from '../interactions.repository';
import type { MaliniDatabase } from '$main/db/driver';
import {
	appendEvent,
	envelopeJson,
	eventJsonFromKindPayload,
	runIsWaitingOnBackgroundWork,
	type AgentEventEnvelope,
} from '../events.repository';
import {
	releaseRunAttachmentsForRetry,
	stagedAttachmentExpiryFrom,
} from '../attachments.repository';
import { openTurnReply } from '../runs.repository';
import { invariant, WORKSTREAM_FOLDER_MISSING } from '$main/errors';
import { all, column, nowIso8601, run, scalar } from '$main/db/rows';
import { repairSessionStatusesWithoutOpenRuns } from '../sessions.repository';

export type LifecycleErrorKind =
	| 'workstream_missing'
	| 'not_a_repository'
	| 'already_running'
	| 'checkout_busy'
	| 'workstream_teardown_pending'
	| 'workstream_teardown_blocked'
	| 'bridge_unavailable'
	| 'invalid_agent_model'
	| 'provider_not_ready'
	| 'invalid_prompt_context'
	| 'start_snapshot_failed'
	| 'db'
	| 'cancel_race'
	| 'cancel_persistence_timeout'
	| 'nothing_to_continue';

export class LifecycleError extends Error {
	override readonly name = 'LifecycleError';
	readonly kind: LifecycleErrorKind;
	readonly detail: string;

	constructor(kind: LifecycleErrorKind, detail = '', runIds: readonly string[] = []) {
		super(LifecycleError.describe(kind, detail, runIds));
		this.kind = kind;
		this.detail = detail;
	}

	static describe(kind: LifecycleErrorKind, detail: string, runIds: readonly string[]): string {
		switch (kind) {
			case 'workstream_missing':
				return WORKSTREAM_FOLDER_MISSING;
			case 'not_a_repository':
				return 'repository checkout is not a git repository';
			case 'already_running':
				return `\`${detail}\` already has an active run`;
			case 'checkout_busy':
				return "An agent is still working in this workstream, so its branch can't move yet.";
			case 'workstream_teardown_pending':
				return `work stream \`${detail}\` is being archived or deleted`;
			case 'workstream_teardown_blocked':
				return `work stream \`${detail}\` has active agent runs; stop them before archiving or deleting: ${runIds.join(', ')}`;
			case 'bridge_unavailable':
				return `bridge unavailable: ${detail}`;
			case 'invalid_agent_model':
				return `invalid agent model: ${detail}`;
			case 'provider_not_ready':
				return detail;
			case 'invalid_prompt_context':
				return `invalid prompt context: ${detail}`;
			case 'start_snapshot_failed':
				return `The prompt was not sent because the workstream state before it could not be saved, so its changes could not be tracked. Make sure the workstream folder exists and is a git checkout, then send it again. Details: ${detail}`;
			case 'db':
				return `db error: ${detail}`;
			case 'cancel_race':
				return `cancel race: ${detail}`;
			case 'cancel_persistence_timeout':
				return `cancel persistence timeout: ${detail}`;
			case 'nothing_to_continue':
				return 'This chat has no stopped turn to continue.';
		}
	}
}

export function asLifecycleDbError(error: unknown): LifecycleError {
	if (error instanceof LifecycleError) return error;
	return new LifecycleError('db', error instanceof Error ? error.message : String(error));
}

export interface SyntheticEventEnvelope {
	sessionId: string;
	runId: string;
	seq: number;
	eventKind: string;
	eventPayload: Record<string, unknown>;
}

export type EmitEnvelope = (envelope: SyntheticEventEnvelope, seq: number) => void;

export function camelEnvelopeJson(
	envelope: SyntheticEventEnvelope,
	seq: number,
): AgentEventEnvelope {
	return envelopeJson(
		envelope.sessionId,
		envelope.runId,
		seq,
		eventJsonFromKindPayload(envelope.eventKind, envelope.eventPayload),
		nowIso8601(),
	);
}

export function emitPersisted(
	db: MaliniDatabase,
	envelope: SyntheticEventEnvelope,
	onEmit: EmitEnvelope,
): number {
	const seq = appendEvent(
		db,
		envelope.sessionId,
		envelope.runId,
		envelope.eventKind,
		envelope.eventPayload,
	);
	onEmit({ ...envelope, seq }, seq);
	return seq;
}

function activeRunRows(db: MaliniDatabase, workstreamId: string): string[] {
	return column(
		db,
		`SELECT r.id FROM agent_runs r
		 JOIN agent_sessions s ON r.session_id = s.id
		 WHERE s.workstream_id = ? AND r.completed_at IS NULL
		 ORDER BY r.started_at ASC`,
		workstreamId,
	);
}

export function hasActiveRun(db: MaliniDatabase, workstreamId: string): boolean {
	return activeRunRows(db, workstreamId).length > 0;
}

export function listActiveRunIds(db: MaliniDatabase, workstreamId: string): string[] {
	return activeRunRows(db, workstreamId);
}

export function listAllActiveRunIds(db: MaliniDatabase): string[] {
	return column(db, 'SELECT id FROM agent_runs WHERE completed_at IS NULL ORDER BY started_at ASC');
}

export function listActiveRunIdsForSession(db: MaliniDatabase, sessionId: string): string[] {
	return column(
		db,
		'SELECT id FROM agent_runs WHERE session_id = ? AND completed_at IS NULL ORDER BY started_at ASC',
		sessionId,
	);
}

export function listActiveRunsWithSessionsForWorkstream(
	db: MaliniDatabase,
	workstreamId: string,
): Array<{ runId: string; sessionId: string }> {
	return all<{ id: string; session_id: string }>(
		db,
		`SELECT r.id, r.session_id FROM agent_runs r
		 JOIN agent_sessions s ON r.session_id = s.id
		 WHERE s.workstream_id = ? AND r.completed_at IS NULL
		 ORDER BY r.started_at ASC`,
		workstreamId,
	).map((row) => ({ runId: row.id, sessionId: row.session_id }));
}

export interface Lease {
	readonly workstreamId: string;
	release(): void;
}

export interface RunLease extends Lease {
	readonly handsOff: boolean;
}

function lease(workstreamId: string, onRelease: () => void): Lease {
	let active = true;
	return {
		workstreamId,
		release() {
			if (!active) return;
			active = false;
			onRelease();
		},
	};
}

interface RunChangeCapture {
	count: number;
	readonly settled: Promise<void>;
	readonly settle: () => void;
}

export class AgentRunLeases {
	private readonly dispatching = new Map<string, string>();
	private readonly capturing = new Map<string, RunChangeCapture>();
	private readonly tearingDown = new Set<string>();
	private readonly movingCheckouts = new Map<string, Promise<void>>();
	private readonly cancelledDispatches = new Map<string, string>();

	cancelDispatch(sessionId: string, runId: string): void {
		this.cancelledDispatches.set(sessionId, runId);
	}

	takeDispatchCancel(sessionId: string, runId: string): boolean {
		if (this.cancelledDispatches.get(sessionId) !== runId) return false;
		this.cancelledDispatches.delete(sessionId);
		return true;
	}

	acquireRun(db: MaliniDatabase, workstreamId: string, sessionId: string, steer = false): RunLease {
		if (this.tearingDown.has(workstreamId)) {
			throw new LifecycleError('workstream_teardown_pending', workstreamId);
		}
		if (this.capturing.has(workstreamId)) {
			throw new LifecycleError('already_running', workstreamId);
		}
		const openRunIds = listActiveRunIdsForSession(db, sessionId);
		const handsOff =
			openRunIds.length > 0 &&
			(steer || openRunIds.every((runId) => runIsWaitingOnBackgroundWork(db, runId)));
		if (this.dispatching.has(sessionId) || (openRunIds.length > 0 && !handsOff)) {
			throw new LifecycleError('already_running', sessionId);
		}
		repairSessionStatusesWithoutOpenRuns(db, workstreamId);
		const busy = scalar(
			db,
			`SELECT COUNT(*) FROM agent_sessions
			 WHERE id = ? AND status IN ('running', 'waiting_for_approval')`,
			sessionId,
		);
		if (busy > 0 && !handsOff) {
			throw new LifecycleError('already_running', sessionId);
		}
		this.dispatching.set(sessionId, workstreamId);
		return { ...lease(workstreamId, () => this.dispatching.delete(sessionId)), handsOff };
	}

	async checkoutSettled(workstreamId: string): Promise<void> {
		while (this.movingCheckouts.has(workstreamId)) await this.movingCheckouts.get(workstreamId);
	}

	acquireCheckoutMove(db: MaliniDatabase, workstreamId: string): Lease {
		if (this.tearingDown.has(workstreamId)) {
			throw new LifecycleError('workstream_teardown_pending', workstreamId);
		}
		if (this.isBusy(workstreamId) || activeRunRows(db, workstreamId).length > 0) {
			throw new LifecycleError('checkout_busy', workstreamId);
		}
		let settle = (): void => {};
		this.movingCheckouts.set(
			workstreamId,
			new Promise<void>((resolve) => {
				settle = resolve;
			}),
		);
		return lease(workstreamId, () => {
			this.movingCheckouts.delete(workstreamId);
			settle();
		});
	}

	acquireRunChangeCapture(workstreamId: string): Lease {
		if (this.tearingDown.has(workstreamId)) {
			throw new LifecycleError('workstream_teardown_pending', workstreamId);
		}
		const capture = this.capturing.get(workstreamId) ?? this.startCapture(workstreamId);
		capture.count += 1;
		return lease(workstreamId, () => {
			capture.count -= 1;
			if (capture.count > 0) return;
			this.capturing.delete(workstreamId);
			capture.settle();
		});
	}

	async runChangeCaptureSettled(workstreamId: string): Promise<void> {
		while (this.capturing.has(workstreamId)) await this.capturing.get(workstreamId)?.settled;
	}

	private startCapture(workstreamId: string): RunChangeCapture {
		let settle = (): void => {};
		const settled = new Promise<void>((resolve) => {
			settle = resolve;
		});
		const capture = { count: 0, settled, settle };
		this.capturing.set(workstreamId, capture);
		return capture;
	}

	acquireRunChangeRecovery(workstreamId: string): Lease {
		if (this.isBusy(workstreamId)) throw new LifecycleError('already_running', workstreamId);
		return this.acquireRunChangeCapture(workstreamId);
	}

	acquireWorkstreamTeardown(db: MaliniDatabase, workstreamId: string): Lease {
		if (this.isBusy(workstreamId)) {
			throw new LifecycleError('workstream_teardown_blocked', workstreamId, [workstreamId]);
		}
		if (this.tearingDown.has(workstreamId)) {
			throw new LifecycleError('workstream_teardown_pending', workstreamId);
		}
		this.tearingDown.add(workstreamId);
		const guard = lease(workstreamId, () => this.tearingDown.delete(workstreamId));
		const activeRunIds = activeRunRows(db, workstreamId);
		if (activeRunIds.length > 0) {
			guard.release();
			throw new LifecycleError('workstream_teardown_blocked', workstreamId, activeRunIds);
		}
		return guard;
	}

	private isBusy(workstreamId: string): boolean {
		return (
			this.capturing.has(workstreamId) ||
			this.movingCheckouts.has(workstreamId) ||
			[...this.dispatching.values()].includes(workstreamId)
		);
	}
}

export const RESET_BY_USER_ERROR = 'reset by user';

interface OpenRun {
	runId: string;
	sessionId: string;
}

interface RunClosing {
	readonly kind: 'run.completed' | 'run.failed';
	readonly payload: Readonly<Record<string, string>>;
	readonly error: string | null;
	readonly sessionStatus: 'completed' | 'idle';
}

function closingOf(db: MaliniDatabase, runId: string, error: string): RunClosing {
	const reply = openTurnReply(db, runId);
	return reply === null
		? { kind: 'run.failed', payload: { error }, error, sessionStatus: 'idle' }
		: {
				kind: 'run.completed',
				payload: { summary: reply },
				error: null,
				sessionStatus: 'completed',
			};
}

function listOpenRunsOrdered(db: MaliniDatabase): OpenRun[] {
	return all<{ id: string; session_id: string }>(
		db,
		`SELECT r.id, r.session_id FROM agent_runs r
		 WHERE r.completed_at IS NULL ORDER BY r.started_at ASC, r.id ASC`,
	).map((row) => ({ runId: row.id, sessionId: row.session_id }));
}

export function terminalizeRunsAfterBridgeLoss(db: MaliniDatabase, emit: EmitEnvelope): number {
	const now = nowIso8601();
	const committed = db.transaction(() => {
		const emitted: Array<[SyntheticEventEnvelope, number]> = [];
		for (const { runId, sessionId } of listOpenRunsOrdered(db)) {
			const closing = closingOf(db, runId, BRIDGE_INTERRUPTED_ERROR);
			const seq = appendEvent(db, sessionId, runId, closing.kind, closing.payload);
			const closed = run(
				db,
				'UPDATE agent_runs SET completed_at = ?, error = ? WHERE id = ? AND completed_at IS NULL',
				now,
				closing.error,
				runId,
			).changes;
			if (closed !== 1) {
				throw invariant(
					`expected one open run \`${runId}\` during bridge recovery, updated ${closed}`,
				);
			}
			closeTerminalInteractions(db, sessionId, runId, now);
			const sessions = run(
				db,
				'UPDATE agent_sessions SET status = ? WHERE id = ?',
				closing.sessionStatus,
				sessionId,
			).changes;
			if (sessions !== 1) {
				throw invariant(
					`expected owning session \`${sessionId}\` during bridge recovery, updated ${sessions}`,
				);
			}
			emitted.push([
				{ sessionId, runId, seq, eventKind: closing.kind, eventPayload: closing.payload },
				seq,
			]);
		}
		return emitted;
	});
	for (const [envelope, seq] of committed) emit(envelope, seq);
	return committed.length;
}

export function reapOrphansOnStartup(db: MaliniDatabase): number {
	const now = nowIso8601();
	const retryExpiresAt = stagedAttachmentExpiryFrom();
	return db.transaction(() => {
		const open = listOpenRunsOrdered(db);
		for (const { runId, sessionId } of open) {
			const closing = closingOf(db, runId, ORPHAN_INTERRUPTED_ERROR);
			appendEvent(db, sessionId, runId, closing.kind, closing.payload);
			const closed = run(
				db,
				'UPDATE agent_runs SET completed_at = ?, error = ? WHERE id = ? AND completed_at IS NULL',
				now,
				closing.error,
				runId,
			).changes;
			if (closed !== 1) {
				throw invariant(`expected one startup orphan run \`${runId}\`, updated ${closed}`);
			}
			closeTerminalInteractions(db, sessionId, runId, now);
			const sessions = run(
				db,
				'UPDATE agent_sessions SET status = ? WHERE id = ?',
				closing.sessionStatus,
				sessionId,
			).changes;
			if (sessions !== 1) {
				throw invariant(
					`expected owning session \`${sessionId}\` during startup recovery, updated ${sessions}`,
				);
			}
			if (closing.error !== null) releaseRunAttachmentsForRetry(db, runId, retryExpiresAt);
		}
		return open.length;
	});
}

export function reapOrphansOnExit(db: MaliniDatabase, emit: EmitEnvelope): string[] {
	const open = listOpenRunsOrdered(db);
	const now = nowIso8601();
	for (const { runId, sessionId } of open) {
		const closing = closingOf(db, runId, ORPHAN_INTERRUPTED_ERROR);
		try {
			emitPersisted(
				db,
				{ sessionId, runId, seq: 0, eventKind: closing.kind, eventPayload: closing.payload },
				emit,
			);
		} catch {}
		try {
			run(
				db,
				'UPDATE agent_runs SET completed_at = ?, error = ? WHERE id = ?',
				now,
				closing.error,
				runId,
			);
			closeTerminalInteractions(db, sessionId, runId, now);
			run(
				db,
				'UPDATE agent_sessions SET status = ? WHERE id = ?',
				closing.sessionStatus,
				sessionId,
			);
		} catch {}
	}
	return open.map(({ runId }) => runId);
}

export function resetWorkstreamRuns(
	db: MaliniDatabase,
	workstreamId: string,
	emit: EmitEnvelope,
): number {
	const openRuns = listActiveRunsWithSessionsForWorkstream(db, workstreamId);
	const now = nowIso8601();
	for (const { runId, sessionId } of openRuns) {
		const closing = closingOf(db, runId, RESET_BY_USER_ERROR);
		try {
			emitPersisted(
				db,
				{ sessionId, runId, seq: 0, eventKind: closing.kind, eventPayload: closing.payload },
				emit,
			);
		} catch {}
		run(
			db,
			"UPDATE agent_runs SET completed_at = ?, summary = COALESCE(summary, 'reset-by-user'), error = ? WHERE id = ?",
			now,
			closing.error,
			runId,
		);
		closeTerminalInteractions(db, sessionId, runId, now);
		run(db, 'UPDATE agent_sessions SET status = ? WHERE id = ?', closing.sessionStatus, sessionId);
	}
	return openRuns.length;
}

export { nowIso8601 };
