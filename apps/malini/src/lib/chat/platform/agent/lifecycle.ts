import { closeTerminalInteractions } from '../interactions.repository';
import type { MaliniDatabase } from '$main/db/driver';
import {
	appendEvent,
	envelopeJson,
	eventJsonFromKindPayload,
	type AgentEventEnvelope,
} from '../events.repository';
import {
	releaseRunAttachmentsForRetry,
	stagedAttachmentExpiryFrom,
} from '../attachments.repository';
import { invariant, WORKSTREAM_FOLDER_MISSING } from '$main/errors';
import { all, column, nowIso8601, run, scalar } from '$main/db/rows';
import { repairSessionStatusesWithoutOpenRuns } from '../sessions.repository';

export type LifecycleErrorKind =
	| 'workstream_missing'
	| 'not_a_repository'
	| 'already_running'
	| 'workstream_teardown_pending'
	| 'workstream_teardown_blocked'
	| 'bridge_unavailable'
	| 'invalid_agent_model'
	| 'invalid_prompt_context'
	| 'start_snapshot_failed'
	| 'db'
	| 'cancel_race'
	| 'cancel_persistence_timeout';

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
			case 'workstream_teardown_pending':
				return `work stream \`${detail}\` is being archived or deleted`;
			case 'workstream_teardown_blocked':
				return `work stream \`${detail}\` has active agent runs; stop them before archiving or deleting: ${runIds.join(', ')}`;
			case 'bridge_unavailable':
				return `bridge unavailable: ${detail}`;
			case 'invalid_agent_model':
				return `invalid agent model: ${detail}`;
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

export class AgentRunLeases {
	private readonly dispatching = new Map<string, string>();
	private readonly capturing = new Map<string, number>();
	private readonly tearingDown = new Set<string>();
	private readonly cancelledDispatches = new Map<string, string>();

	cancelDispatch(sessionId: string, runId: string): void {
		this.cancelledDispatches.set(sessionId, runId);
	}

	takeDispatchCancel(sessionId: string, runId: string): boolean {
		if (this.cancelledDispatches.get(sessionId) !== runId) return false;
		this.cancelledDispatches.delete(sessionId);
		return true;
	}

	acquireRun(db: MaliniDatabase, workstreamId: string, sessionId: string): Lease {
		if (this.tearingDown.has(workstreamId)) {
			throw new LifecycleError('workstream_teardown_pending', workstreamId);
		}
		if (this.capturing.has(workstreamId)) {
			throw new LifecycleError('already_running', workstreamId);
		}
		if (this.dispatching.has(sessionId) || listActiveRunIdsForSession(db, sessionId).length > 0) {
			throw new LifecycleError('already_running', sessionId);
		}
		repairSessionStatusesWithoutOpenRuns(db, workstreamId);
		const busy = scalar(
			db,
			`SELECT COUNT(*) FROM agent_sessions
			 WHERE id = ? AND status IN ('running', 'waiting_for_approval')`,
			sessionId,
		);
		if (busy > 0) {
			throw new LifecycleError('already_running', sessionId);
		}
		this.dispatching.set(sessionId, workstreamId);
		return lease(workstreamId, () => this.dispatching.delete(sessionId));
	}

	acquireRunChangeCapture(workstreamId: string): Lease {
		if (this.tearingDown.has(workstreamId)) {
			throw new LifecycleError('workstream_teardown_pending', workstreamId);
		}
		this.capturing.set(workstreamId, (this.capturing.get(workstreamId) ?? 0) + 1);
		return lease(workstreamId, () => {
			const remaining = (this.capturing.get(workstreamId) ?? 1) - 1;
			if (remaining > 0) this.capturing.set(workstreamId, remaining);
			else this.capturing.delete(workstreamId);
		});
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
			this.capturing.has(workstreamId) || [...this.dispatching.values()].includes(workstreamId)
		);
	}
}

export const ORPHAN_INTERRUPTED_ERROR = 'interrupted: app closed mid-run';

export const BRIDGE_INTERRUPTED_ERROR = 'interrupted: agent bridge restarted';

export const RESET_BY_USER_ERROR = 'reset by user';

interface OpenRun {
	runId: string;
	sessionId: string;
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
	const payload = { error: BRIDGE_INTERRUPTED_ERROR };
	const committed = db.transaction(() => {
		const emitted: Array<[SyntheticEventEnvelope, number]> = [];
		for (const { runId, sessionId } of listOpenRunsOrdered(db)) {
			const seq = appendEvent(db, sessionId, runId, 'run.failed', payload);
			const closed = run(
				db,
				'UPDATE agent_runs SET completed_at = ?, error = ? WHERE id = ? AND completed_at IS NULL',
				now,
				BRIDGE_INTERRUPTED_ERROR,
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
				"UPDATE agent_sessions SET status = 'idle' WHERE id = ?",
				sessionId,
			).changes;
			if (sessions !== 1) {
				throw invariant(
					`expected owning session \`${sessionId}\` during bridge recovery, updated ${sessions}`,
				);
			}
			emitted.push([
				{ sessionId, runId, seq, eventKind: 'run.failed', eventPayload: payload },
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
	const payload = { error: ORPHAN_INTERRUPTED_ERROR };
	return db.transaction(() => {
		const open = listOpenRunsOrdered(db);
		for (const { runId, sessionId } of open) {
			appendEvent(db, sessionId, runId, 'run.failed', payload);
			const closed = run(
				db,
				'UPDATE agent_runs SET completed_at = ?, error = ? WHERE id = ? AND completed_at IS NULL',
				now,
				ORPHAN_INTERRUPTED_ERROR,
				runId,
			).changes;
			if (closed !== 1) {
				throw invariant(`expected one startup orphan run \`${runId}\`, updated ${closed}`);
			}
			closeTerminalInteractions(db, sessionId, runId, now);
			const sessions = run(
				db,
				"UPDATE agent_sessions SET status = 'idle' WHERE id = ?",
				sessionId,
			).changes;
			if (sessions !== 1) {
				throw invariant(
					`expected owning session \`${sessionId}\` during startup recovery, updated ${sessions}`,
				);
			}
			releaseRunAttachmentsForRetry(db, runId, retryExpiresAt);
		}
		return open.length;
	});
}

export function reapOrphansOnExit(db: MaliniDatabase, emit: EmitEnvelope): string[] {
	const open = listOpenRunsOrdered(db);
	const now = nowIso8601();
	for (const { runId, sessionId } of open) {
		try {
			emitPersisted(
				db,
				{
					sessionId,
					runId,
					seq: 0,
					eventKind: 'run.failed',
					eventPayload: { error: ORPHAN_INTERRUPTED_ERROR },
				},
				emit,
			);
		} catch {}
		try {
			run(
				db,
				'UPDATE agent_runs SET completed_at = ?, error = ? WHERE id = ?',
				now,
				ORPHAN_INTERRUPTED_ERROR,
				runId,
			);
			closeTerminalInteractions(db, sessionId, runId, now);
			run(db, "UPDATE agent_sessions SET status = 'idle' WHERE id = ?", sessionId);
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
		try {
			emitPersisted(
				db,
				{
					sessionId,
					runId,
					seq: 0,
					eventKind: 'run.failed',
					eventPayload: { error: RESET_BY_USER_ERROR },
				},
				emit,
			);
		} catch {}
		run(
			db,
			"UPDATE agent_runs SET completed_at = ?, summary = 'reset-by-user', error = ? WHERE id = ?",
			now,
			RESET_BY_USER_ERROR,
			runId,
		);
		closeTerminalInteractions(db, sessionId, runId, now);
		run(db, "UPDATE agent_sessions SET status = 'idle' WHERE id = ?", sessionId);
	}
	return openRuns.length;
}

export { nowIso8601 };
