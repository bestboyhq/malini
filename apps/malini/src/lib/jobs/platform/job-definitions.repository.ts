import type { AgentReasoningEffort } from '$contract/agent';
import type { JobBuiltin, JobDefinitionRecord, JobOutput, JobRunsIn } from '$contract/jobs';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, run } from '$main/db/rows';

interface JobDefinitionRow {
	id: string;
	name: string;
	instructions: string;
	model: string;
	effort: AgentReasoningEffort;
	runs_in: JobRunsIn;
	output: JobOutput;
	builtin: JobBuiltin | null;
	created_at: string;
	updated_at: string;
}

const COLUMNS =
	'id, name, instructions, model, effort, runs_in, output, builtin, created_at, updated_at';

function fromRow(row: JobDefinitionRow): JobDefinitionRecord {
	return {
		id: row.id,
		name: row.name,
		instructions: row.instructions,
		model: row.model,
		effort: row.effort,
		runsIn: row.runs_in,
		output: row.output,
		builtin: row.builtin,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export function listJobDefinitions(db: MaliniDatabase): JobDefinitionRecord[] {
	return all<JobDefinitionRow>(
		db,
		`SELECT ${COLUMNS} FROM job_definitions ORDER BY builtin IS NULL, created_at, rowid`,
	).map(fromRow);
}

export function getJobDefinition(db: MaliniDatabase, id: string): JobDefinitionRecord | null {
	const row = get<JobDefinitionRow>(db, `SELECT ${COLUMNS} FROM job_definitions WHERE id = ?`, id);
	return row ? fromRow(row) : null;
}

export function insertJobDefinition(db: MaliniDatabase, definition: JobDefinitionRecord): boolean {
	return (
		run(
			db,
			`INSERT INTO job_definitions (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT DO NOTHING`,
			definition.id,
			definition.name,
			definition.instructions,
			definition.model,
			definition.effort,
			definition.runsIn,
			definition.output,
			definition.builtin,
			definition.createdAt,
			definition.updatedAt,
		).changes > 0
	);
}

export function updateJobDefinition(db: MaliniDatabase, definition: JobDefinitionRecord): void {
	run(
		db,
		`UPDATE job_definitions
		 SET name = ?, instructions = ?, model = ?, effort = ?, runs_in = ?, output = ?, updated_at = ?
		 WHERE id = ?`,
		definition.name,
		definition.instructions,
		definition.model,
		definition.effort,
		definition.runsIn,
		definition.output,
		definition.updatedAt,
		definition.id,
	);
}

export function deleteJobDefinition(db: MaliniDatabase, id: string): void {
	run(db, 'DELETE FROM job_definitions WHERE id = ?', id);
}
