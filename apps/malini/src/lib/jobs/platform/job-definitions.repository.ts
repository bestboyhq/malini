import type { AgentReasoningEffort } from '$contract/agent';
import type { JobBuiltin, JobDefinitionRecord, JobRunMode, JobRunsIn } from '$contract/jobs';
import { isSkillNameList } from '$contract/skills';
import type { MaliniDatabase } from '$main/db/driver';
import { all, column, get, nowIso8601, parseJsonColumn, run } from '$main/db/rows';

interface JobDefinitionRow {
	id: string;
	name: string;
	instructions: string;
	model: string;
	effort: AgentReasoningEffort;
	runs_in: JobRunsIn;
	skills: string;
	builtin: JobBuiltin | null;
	trigger_when: string | null;
	trigger_mode: JobRunMode | null;
	then_job_id: string | null;
	created_at: string;
	updated_at: string;
}

const COLUMNS =
	'id, name, instructions, model, effort, runs_in, skills, builtin, trigger_when, trigger_mode, then_job_id, created_at, updated_at';

function fromRow(row: JobDefinitionRow): JobDefinitionRecord {
	const skills = parseJsonColumn(row.skills);
	return {
		id: row.id,
		name: row.name,
		instructions: row.instructions,
		model: row.model,
		effort: row.effort,
		runsIn: row.runs_in,
		skills: isSkillNameList(skills) ? skills : [],
		builtin: row.builtin,
		trigger:
			row.trigger_when === null || row.trigger_mode === null
				? null
				: { when: row.trigger_when, mode: row.trigger_mode },
		thenJobId: row.then_job_id,
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
			`INSERT INTO job_definitions (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT DO NOTHING`,
			definition.id,
			definition.name,
			definition.instructions,
			definition.model,
			definition.effort,
			definition.runsIn,
			JSON.stringify(definition.skills),
			definition.builtin,
			definition.trigger?.when ?? null,
			definition.trigger?.mode ?? null,
			definition.thenJobId,
			definition.createdAt,
			definition.updatedAt,
		).changes > 0
	);
}

export function updateJobDefinition(db: MaliniDatabase, definition: JobDefinitionRecord): void {
	run(
		db,
		`UPDATE job_definitions
		 SET name = ?, instructions = ?, model = ?, effort = ?, runs_in = ?, skills = ?,
		     trigger_when = ?, trigger_mode = ?, then_job_id = ?, updated_at = ?
		 WHERE id = ?`,
		definition.name,
		definition.instructions,
		definition.model,
		definition.effort,
		definition.runsIn,
		JSON.stringify(definition.skills),
		definition.trigger?.when ?? null,
		definition.trigger?.mode ?? null,
		definition.thenJobId,
		definition.updatedAt,
		definition.id,
	);
}

export function clearThenLinksTo(db: MaliniDatabase, jobId: string): string[] {
	return column(
		db,
		'UPDATE job_definitions SET then_job_id = NULL, updated_at = ? WHERE then_job_id = ? RETURNING id',
		nowIso8601(),
		jobId,
	);
}

export function deleteJobDefinition(db: MaliniDatabase, id: string): void {
	run(db, 'DELETE FROM job_definitions WHERE id = ?', id);
}
