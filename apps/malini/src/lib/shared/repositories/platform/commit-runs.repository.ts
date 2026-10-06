import type { MaliniDatabase } from '$main/db/driver';
import { get, nowIso8601, run } from '$main/db/rows';

export function commitRunConsumed(
	db: MaliniDatabase,
	workstreamId: string,
	runId: string,
): boolean {
	return (
		get(
			db,
			'SELECT 1 FROM workstream_commit_runs WHERE workstream_id = ? AND run_id = ?',
			workstreamId,
			runId,
		) !== null
	);
}

export function recordCommitRun(
	db: MaliniDatabase,
	workstreamId: string,
	runId: string,
	commitSha: string,
): void {
	run(
		db,
		`INSERT INTO workstream_commit_runs (workstream_id, run_id, commit_sha, committed_at)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(workstream_id, run_id) DO NOTHING`,
		workstreamId,
		runId,
		commitSha,
		nowIso8601(),
	);
}

export function claimCommitRunThreadResolution(
	db: MaliniDatabase,
	workstreamId: string,
	runId: string,
): string | null {
	return (
		get<{ commit_sha: string }>(
			db,
			`UPDATE workstream_commit_runs SET threads_resolved_at = ?
			 WHERE workstream_id = ? AND run_id = ? AND threads_resolved_at IS NULL
			 RETURNING commit_sha`,
			nowIso8601(),
			workstreamId,
			runId,
		)?.commit_sha ?? null
	);
}

export function claimAlreadyPushedRunThreadResolution(
	db: MaliniDatabase,
	workstreamId: string,
	runId: string,
	pushedSha: string,
): boolean {
	const now = nowIso8601();
	return (
		get(
			db,
			`INSERT INTO workstream_commit_runs
			   (workstream_id, run_id, commit_sha, committed_at, threads_resolved_at)
			 VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(workstream_id, run_id) DO NOTHING
			 RETURNING 1`,
			workstreamId,
			runId,
			pushedSha,
			now,
			now,
		) !== null
	);
}
