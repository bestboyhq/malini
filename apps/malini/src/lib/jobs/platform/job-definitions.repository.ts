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
	skill_preset_id: string | null;
	builtin: JobBuiltin | null;
	created_at: string;
	updated_at: string;
}

const COLUMNS =
	'id, name, instructions, model, effort, runs_in, output, skill_preset_id, builtin, created_at, updated_at';

function fromRow(row: JobDefinitionRow): JobDefinitionRecord {
	return {
		id: row.id,
		name: row.name,
		instructions: row.instructions,
		model: row.model,
		effort: row.effort,
		runsIn: row.runs_in,
		output: row.output,
		skillPresetId: row.skill_preset_id,
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

export function getBuiltinJobDefinition(
	db: MaliniDatabase,
	builtin: JobBuiltin,
): JobDefinitionRecord | null {
	const row = get<JobDefinitionRow>(
		db,
		`SELECT ${COLUMNS} FROM job_definitions WHERE builtin = ?`,
		builtin,
	);
	return row ? fromRow(row) : null;
}

export function insertJobDefinition(db: MaliniDatabase, definition: JobDefinitionRecord): boolean {
	return (
		run(
			db,
			`INSERT INTO job_definitions (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT DO NOTHING`,
			definition.id,
			definition.name,
			definition.instructions,
			definition.model,
			definition.effort,
			definition.runsIn,
			definition.output,
			definition.skillPresetId,
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
		 SET name = ?, instructions = ?, model = ?, effort = ?, runs_in = ?, output = ?,
		     skill_preset_id = ?, updated_at = ?
		 WHERE id = ?`,
		definition.name,
		definition.instructions,
		definition.model,
		definition.effort,
		definition.runsIn,
		definition.output,
		definition.skillPresetId,
		definition.updatedAt,
		definition.id,
	);
}

export function deleteJobDefinition(db: MaliniDatabase, id: string): void {
	run(db, 'DELETE FROM job_definitions WHERE id = ?', id);
}
