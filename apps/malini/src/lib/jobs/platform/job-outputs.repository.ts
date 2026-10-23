import type { JobOutputRecord, JobSetupRecord } from '$contract/jobs';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, run } from '$main/db/rows';

export const JOB_OUTPUT_EXCERPT_LENGTH = 240;

interface JobSetupRow {
	id: string;
	model: string;
	instructions: string;
	expected_rate: number | null;
	created_at: string;
}

export interface JobOutputRow {
	id: string;
	setup_id: string;
	excerpt: string;
	output: string | null;
	error: string | null;
	created_at: string;
}

const SETUP_COLUMNS = 'id, model, instructions, expected_rate, created_at';

const OUTPUT_COLUMNS = `id, setup_id, substr(input, 1, ${JOB_OUTPUT_EXCERPT_LENGTH}) AS excerpt, output, error, created_at`;

function setupFromRow(row: JobSetupRow): JobSetupRecord {
	return {
		id: row.id,
		model: row.model,
		instructions: row.instructions,
		expectedRate: row.expected_rate,
		createdAt: row.created_at,
	};
}

export function outputFromRow(row: JobOutputRow): JobOutputRecord {
	return {
		id: row.id,
		setupId: row.setup_id,
		excerpt: row.excerpt,
		output: row.output,
		error: row.error,
		createdAt: row.created_at,
	};
}

export function listJobSetups(db: MaliniDatabase, definitionId: string): JobSetupRecord[] {
	return all<JobSetupRow>(
		db,
		`SELECT ${SETUP_COLUMNS} FROM job_setups WHERE definition_id = ? ORDER BY created_at, rowid`,
		definitionId,
	).map(setupFromRow);
}

export function latestJobSetup(db: MaliniDatabase, definitionId: string): JobSetupRecord | null {
	const row = get<JobSetupRow>(
		db,
		`SELECT ${SETUP_COLUMNS} FROM job_setups WHERE definition_id = ?
		 ORDER BY created_at DESC, rowid DESC LIMIT 1`,
		definitionId,
	);
	return row ? setupFromRow(row) : null;
}

export function insertJobSetup(
	db: MaliniDatabase,
	definitionId: string,
	setup: JobSetupRecord,
): void {
	run(
		db,
		`INSERT INTO job_setups (id, definition_id, model, instructions, expected_rate, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		setup.id,
		definitionId,
		setup.model,
		setup.instructions,
		setup.expectedRate,
		setup.createdAt,
	);
}

export function insertJobOutput(
	db: MaliniDatabase,
	output: Readonly<{
		id: string;
		definitionId: string;
		setupId: string;
		input: string;
		output: string | null;
		error: string | null;
		createdAt: string;
	}>,
): void {
	run(
		db,
		`INSERT INTO job_outputs (id, definition_id, setup_id, input, output, error, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		output.id,
		output.definitionId,
		output.setupId,
		output.input,
		output.output,
		output.error,
		output.createdAt,
	);
}

export function listJobOutputs(
	db: MaliniDatabase,
	definitionId: string,
	since: string,
): JobOutputRecord[] {
	return all<JobOutputRow>(
		db,
		`SELECT ${OUTPUT_COLUMNS} FROM job_outputs
		 WHERE definition_id = ? AND created_at >= ?
		 ORDER BY created_at DESC, rowid DESC`,
		definitionId,
		since,
	).map(outputFromRow);
}

export function recentJobOutputIds(
	db: MaliniDatabase,
	definitionId: string,
	limit: number,
): string[] {
	return all<{ id: string }>(
		db,
		`SELECT id FROM job_outputs WHERE definition_id = ?
		 ORDER BY created_at DESC, rowid DESC LIMIT ?`,
		definitionId,
		limit,
	).map((row) => row.id);
}

export function jobOutputInput(db: MaliniDatabase, outputId: string): string | null {
	return (
		get<{ input: string }>(db, 'SELECT input FROM job_outputs WHERE id = ?', outputId)?.input ??
		null
	);
}
