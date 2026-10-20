import type { MaliniDatabase } from '$main/db/driver';
import {
	appendEvent,
	isNewTalkEventKind,
	latestEventId,
	listEventRowsForSession,
} from './events.repository';
import { invariant } from '$main/errors';
import { all, column, get, isRecord, nowIso8601, run, scalar } from '$main/db/rows';
import { workstreamHasOpenRun } from './runs.repository';
import type { CheckpointRestoreRedoResult } from '$contract/agent';

export type { CheckpointRestoreRedoResult };

export interface AgentCheckpoint {
	id: string;
	workstreamId: string;
	sessionId: string;
	runId: string;
	userMessageSeq: number | null;
	gitRef: string;
	gitCommit: string;
	createdAt: string;
}

export interface AgentUserBaseline {
	id: string;
	workstreamId: string;
	sessionId: string;
	runId: string;
	gitRef: string;
	gitCommit: string;
	createdAt: string;
}

export interface CheckpointSupersedeResult {
	sessionId: string;
	restoreSeq: number;
	obsoletedRunIds: string[];
}

export interface RestoreSalvage {
	ref: string;
	commit: string;
}

export interface SupersedeEvent {
	sessionId: string;
	runId: string;
	seq: number;
	eventKind: string;
	eventPayload: Record<string, unknown>;
}

export type SupersedeEmit = (event: SupersedeEvent, seq: number) => void;

export interface WorkstreamSnapshotRefs {
	checkpointRefs: string[];
	runChangeRefs: string[];
	userBaselineRefs: string[];
}

interface CheckpointRow {
	id: string;
	workstream_id: string;
	session_id: string;
	run_id: string;
	user_message_seq: number | null;
	git_ref: string;
	git_commit: string;
	created_at: string;
}

const CHECKPOINT_COLUMNS =
	'id, workstream_id, session_id, run_id, user_message_seq, git_ref, git_commit, created_at';

function checkpointFromRow(row: CheckpointRow): AgentCheckpoint {
	return {
		id: row.id,
		workstreamId: row.workstream_id,
		sessionId: row.session_id,
		runId: row.run_id,
		userMessageSeq: row.user_message_seq,
		gitRef: row.git_ref,
		gitCommit: row.git_commit,
		createdAt: row.created_at,
	};
}

interface BaselineRow {
	id: string;
	workstream_id: string;
	session_id: string;
	run_id: string;
	git_ref: string;
	git_commit: string;
	created_at: string;
}

function baselineFromRow(row: BaselineRow): AgentUserBaseline {
	return {
		id: row.id,
		workstreamId: row.workstream_id,
		sessionId: row.session_id,
		runId: row.run_id,
		gitRef: row.git_ref,
		gitCommit: row.git_commit,
		createdAt: row.created_at,
	};
}

export function insertCheckpoint(db: MaliniDatabase, checkpoint: AgentCheckpoint): void {
	run(
		db,
		`INSERT INTO agent_checkpoints
		 (id, workstream_id, session_id, run_id, user_message_seq, git_ref, git_commit, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		checkpoint.id,
		checkpoint.workstreamId,
		checkpoint.sessionId,
		checkpoint.runId,
		checkpoint.userMessageSeq,
		checkpoint.gitRef,
		checkpoint.gitCommit,
		checkpoint.createdAt,
	);
}

export function bindCheckpointToUserMessage(
	db: MaliniDatabase,
	checkpointId: string,
	seq: number,
): void {
	const { changes } = run(
		db,
		'UPDATE agent_checkpoints SET user_message_seq = ? WHERE id = ?',
		seq,
		checkpointId,
	);
	if (changes !== 1) {
		throw invariant(`expected one checkpoint \`${checkpointId}\`, updated ${changes}`);
	}
}

export function getCheckpoint(
	db: MaliniDatabase,
	workstreamId: string,
	checkpointId: string,
): AgentCheckpoint | null {
	const row = get<CheckpointRow>(
		db,
		`SELECT ${CHECKPOINT_COLUMNS} FROM agent_checkpoints WHERE id = ? AND workstream_id = ?`,
		checkpointId,
		workstreamId,
	);
	return row ? checkpointFromRow(row) : null;
}

export function getCheckpointById(
	db: MaliniDatabase,
	checkpointId: string,
): AgentCheckpoint | null {
	const row = get<CheckpointRow>(
		db,
		`SELECT ${CHECKPOINT_COLUMNS} FROM agent_checkpoints WHERE id = ?`,
		checkpointId,
	);
	return row ? checkpointFromRow(row) : null;
}

export function getCheckpointForRun(db: MaliniDatabase, runId: string): AgentCheckpoint | null {
	const row = get<CheckpointRow>(
		db,
		`SELECT ${CHECKPOINT_COLUMNS} FROM agent_checkpoints WHERE run_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
		runId,
	);
	return row ? checkpointFromRow(row) : null;
}

export function checkpointRestoreSeq(checkpoint: AgentCheckpoint): number {
	if (checkpoint.userMessageSeq === null) {
		throw invariant(`checkpoint \`${checkpoint.id}\` is not bound to a user message`);
	}
	return checkpoint.userMessageSeq;
}

interface LaterRunRow {
	runId: string;
	sessionId: string;
	firstSeq: number;
}

export function supersedeSessionFromCheckpoint(
	db: MaliniDatabase,
	checkpoint: AgentCheckpoint,
	salvage: RestoreSalvage | null,
	emit: SupersedeEmit,
): CheckpointSupersedeResult {
	const fromSeq = checkpointRestoreSeq(checkpoint);
	const { sessionId, workstreamId } = checkpoint;
	const at = nowIso8601();
	const pending: Array<{ event: SupersedeEvent; seq: number }> = [];
	const queue = (event: SupersedeEvent, seq: number): void => {
		pending.push({ event, seq });
	};
	const result = db.transaction((): CheckpointSupersedeResult => {
		const toSeq = latestEventId(db, sessionId);
		const runStartSeq = scalar(
			db,
			`SELECT COALESCE(MIN(e.seq), ?) FROM agent_events e
			 JOIN agent_runs r ON r.id = e.run_id AND r.session_id = e.session_id
			 WHERE e.run_id = ?`,
			fromSeq,
			checkpoint.runId,
		);
		const laterRuns = all<LaterRunRow>(
			db,
			`SELECT r.id AS runId, r.session_id AS sessionId, MIN(e.seq) AS firstSeq
			 FROM agent_runs r
			 JOIN agent_events e ON e.run_id = r.id AND e.session_id = r.session_id
			 JOIN agent_sessions s ON s.id = r.session_id
			 WHERE s.workstream_id = ? AND e.seq >= ? AND r.obsoleted_at IS NULL
			 GROUP BY r.id
			 ORDER BY firstSeq`,
			workstreamId,
			Math.min(fromSeq, runStartSeq),
		);
		const obsoletedRunIds = laterRuns.map((row) => row.runId);

		const restoredPayload: Record<string, unknown> = {
			workstreamId,
			checkpointId: checkpoint.id,
			salvageRef: salvage?.ref ?? null,
			salvageCommit: salvage?.commit ?? null,
			fromSeq,
			toSeq,
			obsoletedRunIds,
			at,
		};
		const restoreSeq = appendEvent(
			db,
			sessionId,
			checkpoint.runId,
			'checkpoint.restored',
			restoredPayload,
		);
		queue(
			{
				sessionId,
				runId: checkpoint.runId,
				seq: restoreSeq,
				eventKind: 'checkpoint.restored',
				eventPayload: restoredPayload,
			},
			restoreSeq,
		);

		const supersededPayload: Record<string, unknown> = { fromSeq, toSeq, restoreSeq, at };
		const supersededSeq = appendEvent(
			db,
			sessionId,
			checkpoint.runId,
			'turn.superseded',
			supersededPayload,
		);
		queue(
			{
				sessionId,
				runId: checkpoint.runId,
				seq: supersededSeq,
				eventKind: 'turn.superseded',
				eventPayload: supersededPayload,
			},
			supersededSeq,
		);

		for (const row of laterRuns) {
			if (row.sessionId !== sessionId) {
				const obsoletePayload: Record<string, unknown> = {
					runId: row.runId,
					restoreSeq,
					at,
				};
				const obsoleteSeq = appendEvent(
					db,
					row.sessionId,
					row.runId,
					'run.obsoleted',
					obsoletePayload,
				);
				queue(
					{
						sessionId: row.sessionId,
						runId: row.runId,
						seq: obsoleteSeq,
						eventKind: 'run.obsoleted',
						eventPayload: obsoletePayload,
					},
					obsoleteSeq,
				);
			}
			run(
				db,
				'UPDATE agent_runs SET obsoleted_at = ? WHERE id = ? AND obsoleted_at IS NULL',
				at,
				row.runId,
			);
			run(
				db,
				'UPDATE agent_checkpoints SET obsoleted_at = ? WHERE run_id = ? AND obsoleted_at IS NULL',
				at,
				row.runId,
			);
		}

		run(db, "UPDATE agent_sessions SET status = 'idle' WHERE id = ?", sessionId);
		return { sessionId, restoreSeq, obsoletedRunIds };
	});
	for (const entry of pending) emit(entry.event, entry.seq);
	return result;
}

export function listWorkstreamSnapshotRefs(
	db: MaliniDatabase,
	workstreamId: string,
): WorkstreamSnapshotRefs {
	return {
		checkpointRefs: column(
			db,
			'SELECT git_ref FROM agent_checkpoints WHERE workstream_id = ? ORDER BY created_at ASC, id ASC',
			workstreamId,
		),
		runChangeRefs: column(
			db,
			`SELECT c.after_ref FROM agent_run_changes c
			 JOIN agent_checkpoints p ON p.id = c.checkpoint_id
			 WHERE p.workstream_id = ? ORDER BY c.captured_at ASC, c.run_id ASC`,
			workstreamId,
		),
		userBaselineRefs: column(
			db,
			'SELECT git_ref FROM agent_user_baselines WHERE workstream_id = ? ORDER BY created_at ASC, id ASC',
			workstreamId,
		),
	};
}

export function insertUserBaseline(db: MaliniDatabase, baseline: AgentUserBaseline): void {
	run(
		db,
		`INSERT INTO agent_user_baselines
		 (id, workstream_id, session_id, run_id, git_ref, git_commit, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		baseline.id,
		baseline.workstreamId,
		baseline.sessionId,
		baseline.runId,
		baseline.gitRef,
		baseline.gitCommit,
		baseline.createdAt,
	);
}

export function getUserBaselineForRun(db: MaliniDatabase, runId: string): AgentUserBaseline | null {
	const row = get<BaselineRow>(
		db,
		`SELECT id, workstream_id, session_id, run_id, git_ref, git_commit, created_at
		 FROM agent_user_baselines WHERE run_id = ?
		 ORDER BY created_at DESC, id DESC LIMIT 1`,
		runId,
	);
	return row ? baselineFromRow(row) : null;
}

export interface CheckpointRestoreRedoPlan {
	sessionId: string;
	restoreSeq: number;
	runId: string;
	fromSeq: number;
	toSeq: number;
	salvageCommit: string;
	obsoletedRunIds: string[];
}

export function planCheckpointRestoreRedo(
	db: MaliniDatabase,
	workstreamId: string,
	sessionId: string,
	restoreSeq: number,
): CheckpointRestoreRedoPlan {
	if (workstreamHasOpenRun(db, workstreamId)) {
		throw invariant('wait for the active run to finish before redoing an undo');
	}
	const rows = listEventRowsForSession(db, sessionId, 0);
	const restored = rows.find((row) => row.seq === restoreSeq && row.kind === 'checkpoint.restored');
	if (!restored || !isRecord(restored.payload)) {
		throw invariant(`no checkpoint.restored event at seq \`${restoreSeq}\` in this chat`);
	}
	const alreadyRedone = rows.some(
		(row) =>
			row.kind === 'turn.restored' &&
			isRecord(row.payload) &&
			row.payload['restoreSeq'] === restoreSeq,
	);
	if (alreadyRedone) throw invariant('this undo has already been redone');
	const fromSeq = restored.payload['fromSeq'];
	const toSeq = restored.payload['toSeq'];
	const salvageCommit = restored.payload['salvageCommit'];
	if (typeof fromSeq !== 'number' || typeof toSeq !== 'number') {
		throw invariant(`checkpoint.restored event \`${restoreSeq}\` is malformed`);
	}
	if (typeof salvageCommit !== 'string' || salvageCommit.length === 0) {
		throw invariant('the undo saved no salvage snapshot; it cannot be redone');
	}
	const rawRuns = restored.payload['obsoletedRunIds'];
	const obsoletedRunIds = Array.isArray(rawRuns)
		? rawRuns.filter((runId): runId is string => typeof runId === 'string')
		: [];
	const newTalk = rows.find((row) => row.seq > restoreSeq && isNewTalkEventKind(row.kind));
	if (newTalk) throw invariant('the chat has new talk since the undo; branch instead');
	for (const runId of obsoletedRunIds) {
		const owner = get<{ session_id: string }>(
			db,
			'SELECT session_id FROM agent_runs WHERE id = ?',
			runId,
		);
		if (!owner) continue;
		const startedAfter = listEventRowsForSession(db, owner.session_id, restoreSeq).some(
			(row) => row.kind === 'run.started',
		);
		if (startedAfter) throw invariant('a reverted chat has a newer run; branch instead');
	}
	return {
		sessionId,
		restoreSeq,
		runId: restored.runId,
		fromSeq,
		toSeq,
		salvageCommit,
		obsoletedRunIds,
	};
}

export function applyCheckpointRestoreRedo(
	db: MaliniDatabase,
	plan: CheckpointRestoreRedoPlan,
	emit: SupersedeEmit,
): CheckpointRestoreRedoResult {
	const at = nowIso8601();
	const pending: Array<{ event: SupersedeEvent; seq: number }> = [];
	const queue = (event: SupersedeEvent, seq: number): void => {
		pending.push({ event, seq });
	};
	const result = db.transaction((): CheckpointRestoreRedoResult => {
		const restoredPayload: Record<string, unknown> = {
			fromSeq: plan.fromSeq,
			toSeq: plan.toSeq,
			restoreSeq: plan.restoreSeq,
			at,
		};
		const restoredSeq = appendEvent(
			db,
			plan.sessionId,
			plan.runId,
			'turn.restored',
			restoredPayload,
		);
		queue(
			{
				sessionId: plan.sessionId,
				runId: plan.runId,
				seq: restoredSeq,
				eventKind: 'turn.restored',
				eventPayload: restoredPayload,
			},
			restoredSeq,
		);
		for (const runId of plan.obsoletedRunIds) {
			const owner = get<{ session_id: string }>(
				db,
				'SELECT session_id FROM agent_runs WHERE id = ?',
				runId,
			);
			if (!owner) continue;
			const runRestoredPayload: Record<string, unknown> = {
				runId,
				restoreSeq: plan.restoreSeq,
				at,
			};
			const seq = appendEvent(db, owner.session_id, runId, 'run.restored', runRestoredPayload);
			queue(
				{
					sessionId: owner.session_id,
					runId,
					seq,
					eventKind: 'run.restored',
					eventPayload: runRestoredPayload,
				},
				seq,
			);
			run(db, 'UPDATE agent_runs SET obsoleted_at = NULL WHERE id = ?', runId);
			run(db, 'UPDATE agent_checkpoints SET obsoleted_at = NULL WHERE run_id = ?', runId);
		}
		run(db, "UPDATE agent_sessions SET status = 'idle' WHERE id = ?", plan.sessionId);
		return {
			sessionId: plan.sessionId,
			restoreSeq: plan.restoreSeq,
			restoredRunIds: plan.obsoletedRunIds,
		};
	});
	for (const entry of pending) emit(entry.event, entry.seq);
	return result;
}
