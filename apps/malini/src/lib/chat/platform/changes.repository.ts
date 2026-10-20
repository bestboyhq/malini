import type { MaliniDatabase } from '$main/db/driver';
import { invariant } from '$main/errors';
import { all, column, get, intToBool, run, scalar } from '$main/db/rows';
import type {
	AgentRunChangePatch,
	AgentRunChangeSummary,
	AgentRunChangedFile,
	AgentSessionChangePatch,
	AgentSessionChangeTurnPatch,
	AgentSessionChangedFile,
	AgentSessionChanges,
} from '$contract/agent';

export type {
	AgentRunChangePatch,
	AgentRunChangeSummary,
	AgentRunChangedFile,
	AgentSessionChangePatch,
	AgentSessionChangeTurnPatch,
	AgentSessionChangedFile,
	AgentSessionChanges,
};

export interface AgentRunChange {
	runId: string;
	checkpointId: string;
	beforeCommit: string;
	afterCommit: string;
	afterRef: string;
	capturedAt: string;
	files: AgentRunChangedFile[];
}

interface RunChangeRow {
	run_id: string;
	checkpoint_id: string;
	before_commit: string;
	after_commit: string;
	after_ref: string;
	captured_at: string;
}

interface ChangedFileRow {
	path: string;
	additions: number;
	deletions: number;
	is_binary: number;
}

function loadRunChange(db: MaliniDatabase, runId: string): AgentRunChange | null {
	const header = get<RunChangeRow>(
		db,
		`SELECT run_id, checkpoint_id, before_commit, after_commit, after_ref, captured_at
		 FROM agent_run_changes WHERE run_id = ?`,
		runId,
	);
	if (!header) return null;
	const files = all<ChangedFileRow>(
		db,
		`SELECT path, additions, deletions, is_binary FROM agent_run_change_files
		 WHERE run_id = ? ORDER BY path ASC`,
		header.run_id,
	).map((row) => ({
		path: row.path,
		additions: row.additions,
		deletions: row.deletions,
		isBinary: intToBool(row.is_binary),
	}));
	return {
		runId: header.run_id,
		checkpointId: header.checkpoint_id,
		beforeCommit: header.before_commit,
		afterCommit: header.after_commit,
		afterRef: header.after_ref,
		capturedAt: header.captured_at,
		files,
	};
}

export function insertRunChange(db: MaliniDatabase, change: AgentRunChange): void {
	db.transaction(() => {
		const validContext = scalar(
			db,
			`SELECT COUNT(*) FROM agent_runs r
			 JOIN agent_checkpoints c ON c.run_id = r.id AND c.session_id = r.session_id
			 WHERE r.id = ? AND c.id = ? AND c.git_commit = ?
			   AND r.completed_at IS NOT NULL`,
			change.runId,
			change.checkpointId,
			change.beforeCommit,
		);
		if (validContext !== 1) {
			throw invariant(
				`run change \`${change.runId}\` requires one terminal run and its matching pre-run checkpoint`,
			);
		}
		run(
			db,
			`INSERT INTO agent_run_changes
			 (run_id, checkpoint_id, before_commit, after_commit, after_ref, captured_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			change.runId,
			change.checkpointId,
			change.beforeCommit,
			change.afterCommit,
			change.afterRef,
			change.capturedAt,
		);
		for (const file of change.files) {
			if (!Number.isSafeInteger(file.additions) || file.additions < 0) {
				throw invariant(`run change additions exceed SQLite range for \`${file.path}\``);
			}
			if (!Number.isSafeInteger(file.deletions) || file.deletions < 0) {
				throw invariant(`run change deletions exceed SQLite range for \`${file.path}\``);
			}
			run(
				db,
				`INSERT INTO agent_run_change_files
				 (run_id, path, additions, deletions, is_binary) VALUES (?, ?, ?, ?, ?)`,
				change.runId,
				file.path,
				file.additions,
				file.deletions,
				file.isBinary,
			);
		}
	});
}

export function getRunChange(db: MaliniDatabase, runId: string): AgentRunChange | null {
	return loadRunChange(db, runId);
}

export function getRunChangeForSession(
	db: MaliniDatabase,
	sessionId: string,
	runId: string,
): AgentRunChange | null {
	const belongs = scalar(
		db,
		'SELECT COUNT(*) FROM agent_runs WHERE id = ? AND session_id = ? AND obsoleted_at IS NULL',
		runId,
		sessionId,
	);
	if (belongs === 0) return null;
	return loadRunChange(db, runId);
}

export function listRunChangesForSession(db: MaliniDatabase, sessionId: string): AgentRunChange[] {
	const exists = scalar(db, 'SELECT COUNT(*) FROM agent_sessions WHERE id = ?', sessionId);
	if (exists !== 1) throw invariant(`agent session \`${sessionId}\` does not exist`);
	const runIds = column(
		db,
		`SELECT c.run_id FROM agent_run_changes c
		 JOIN agent_runs r ON r.id = c.run_id
		 WHERE r.session_id = ? AND r.obsoleted_at IS NULL
		 ORDER BY r.started_at ASC, c.run_id ASC`,
		sessionId,
	);
	return runIds.map((runId) => {
		const change = loadRunChange(db, runId);
		if (!change) throw invariant(`run change \`${runId}\` disappeared during session projection`);
		return change;
	});
}

export function sessionChanges(db: MaliniDatabase, sessionId: string): AgentSessionChanges {
	const changes = listRunChangesForSession(db, sessionId);
	const files = new Map<string, AgentSessionChangedFile>();
	const runs = changes.map((change) => {
		for (const file of change.files) {
			let entry = files.get(file.path);
			if (!entry) {
				entry = { path: file.path, additions: 0, deletions: 0, isBinary: false, runIds: [] };
				files.set(file.path, entry);
			}
			entry.additions += file.additions;
			entry.deletions += file.deletions;
			if (!Number.isSafeInteger(entry.additions)) {
				throw invariant(`session \`${sessionId}\` additions overflow for \`${file.path}\``);
			}
			if (!Number.isSafeInteger(entry.deletions)) {
				throw invariant(`session \`${sessionId}\` deletions overflow for \`${file.path}\``);
			}
			entry.isBinary ||= file.isBinary;
			entry.runIds.push(change.runId);
		}
		return {
			runId: change.runId,
			beforeCommit: change.beforeCommit,
			afterCommit: change.afterCommit,
			files: change.files,
			capturedAt: change.capturedAt,
		};
	});
	const first = changes[0];
	const last = changes[changes.length - 1];
	return {
		sessionId,
		runs,
		files: [...files.values()].sort((left, right) =>
			left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
		),
		beforeCommit: first?.beforeCommit ?? null,
		afterCommit: last?.afterCommit ?? null,
		capturedAt: last?.capturedAt ?? null,
	};
}

export function latestWorkstreamRunChangeCommit(
	db: MaliniDatabase,
	workstreamId: string,
): string | null {
	const row = get<{ after_commit: string }>(
		db,
		`SELECT c.after_commit FROM agent_run_changes c
		 JOIN agent_checkpoints p ON p.id = c.checkpoint_id
		 WHERE p.workstream_id = ?
		 ORDER BY c.captured_at DESC, c.run_id DESC LIMIT 1`,
		workstreamId,
	);
	return row ? row.after_commit : null;
}

export function terminalRunsWithoutChanges(db: MaliniDatabase, sessionId: string): string[] {
	return column(
		db,
		`SELECT r.id FROM agent_runs r
		 LEFT JOIN agent_run_changes c ON c.run_id = r.id
		 WHERE r.session_id = ? AND r.completed_at IS NOT NULL AND r.obsoleted_at IS NULL
		   AND c.run_id IS NULL
		 ORDER BY r.started_at ASC, r.id ASC`,
		sessionId,
	);
}

export function previousRunSnapshotCommit(
	db: MaliniDatabase,
	workstreamId: string,
	runId: string,
): string | null {
	const row = get<{ snapshot: string }>(
		db,
		`SELECT snapshot FROM (
		   SELECT c.after_commit AS snapshot, r.started_at AS started_at, 1 AS rank
		   FROM agent_run_changes c
		   JOIN agent_runs r ON r.id = c.run_id
		   JOIN agent_checkpoints p ON p.id = c.checkpoint_id
		   WHERE p.workstream_id = ?
		   UNION ALL
		   SELECT p.git_commit, r.started_at, 0
		   FROM agent_checkpoints p
		   JOIN agent_runs r ON r.id = p.run_id
		   WHERE p.workstream_id = ?
		 )
		 WHERE started_at < (SELECT started_at FROM agent_runs WHERE id = ?)
		 ORDER BY started_at DESC, rank DESC LIMIT 1`,
		workstreamId,
		workstreamId,
		runId,
	);
	return row ? row.snapshot : null;
}

export function nextRunCheckpointCommit(
	db: MaliniDatabase,
	workstreamId: string,
	runId: string,
): string | null {
	const row = get<{ git_commit: string }>(
		db,
		`SELECT p.git_commit FROM agent_checkpoints p
		 JOIN agent_runs r ON r.id = p.run_id
		 WHERE p.workstream_id = ?
		   AND r.started_at > (SELECT started_at FROM agent_runs WHERE id = ?)
		 ORDER BY r.started_at ASC, p.created_at ASC LIMIT 1`,
		workstreamId,
		runId,
	);
	return row ? row.git_commit : null;
}
