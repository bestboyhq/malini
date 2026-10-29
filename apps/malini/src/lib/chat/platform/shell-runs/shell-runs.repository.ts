import type { ShellRun, ShellRunState } from '$contract/shell-runs';
import type { MaliniDatabase } from '$main/db/driver';
import { all, run } from '$main/db/rows';

export type StoredShellRun = Readonly<{ run: ShellRun; reported: boolean }>;

type ShellRunRow = {
	id: string;
	session_id: string;
	workstream_id: string;
	anchor_message: string;
	anchor_block: number;
	command: string;
	state: Exclude<ShellRunState, 'running'>;
	exit_code: number | null;
	output: string;
	started_at: string;
	finished_at: string;
	reported: number;
};

export function storedShellRuns(db: MaliniDatabase): StoredShellRun[] {
	return all<ShellRunRow>(db, 'SELECT * FROM shell_runs ORDER BY started_at').map((row) => ({
		run: {
			id: row.id,
			workstreamId: row.workstream_id,
			sessionId: row.session_id,
			anchor: { message: row.anchor_message, block: row.anchor_block },
			command: row.command,
			state: row.state,
			exitCode: row.exit_code,
			output: row.output,
			startedAt: row.started_at,
			finishedAt: row.finished_at,
		},
		reported: row.reported === 1,
	}));
}

export function storeShellRun(
	db: MaliniDatabase,
	{ run: shellRun, reported }: StoredShellRun,
): void {
	run(
		db,
		`INSERT OR REPLACE INTO shell_runs (id, session_id, workstream_id, anchor_message, anchor_block,
		 command, state, exit_code, output, started_at, finished_at, reported)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		shellRun.id,
		shellRun.sessionId,
		shellRun.workstreamId,
		shellRun.anchor.message,
		shellRun.anchor.block,
		shellRun.command,
		shellRun.state,
		shellRun.exitCode,
		shellRun.output,
		shellRun.startedAt,
		shellRun.finishedAt,
		reported,
	);
}

export function markShellRunReported(db: MaliniDatabase, id: string): void {
	run(db, 'UPDATE shell_runs SET reported = 1 WHERE id = ?', id);
}

export function deleteShellRun(db: MaliniDatabase, id: string): void {
	run(db, 'DELETE FROM shell_runs WHERE id = ?', id);
}
