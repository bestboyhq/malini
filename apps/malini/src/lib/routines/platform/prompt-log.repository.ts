import type { MaliniDatabase } from '$main/db/driver';
import { all } from '$main/db/rows';
import type { RoutinePromptSample } from './prompt-clustering.service';

interface PromptRow {
	run_id: string;
	session_id: string;
	workstream_id: string;
	prompt: string;
	started_at: string;
}

export function listRecentPrompts(db: MaliniDatabase, limit: number): RoutinePromptSample[] {
	return all<PromptRow>(
		db,
		`SELECT r.id AS run_id, r.session_id, s.workstream_id, r.prompt, r.started_at
		 FROM agent_runs r
		 JOIN agent_sessions s ON s.id = r.session_id
		 WHERE r.automated = 0
		 ORDER BY r.started_at DESC, r.id DESC
		 LIMIT ?`,
		limit,
	)
		.reverse()
		.map((row) => ({
			runId: row.run_id,
			sessionId: row.session_id,
			workstreamId: row.workstream_id,
			text: row.prompt,
			submittedAt: row.started_at,
		}));
}
