import type { AutomationOutputRecord, AutomationSetupRecord } from '$contract/automations';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, run } from '$main/db/rows';

export const AUTOMATION_OUTPUT_EXCERPT_LENGTH = 240;

interface AutomationSetupRow {
	id: string;
	provider: string;
	model: string;
	instructions: string;
	expected_rate: number | null;
	created_at: string;
}

export interface AutomationOutputRow {
	id: string;
	setup_id: string;
	excerpt: string;
	output: string | null;
	error: string | null;
	created_at: string;
}

const SETUP_COLUMNS = 'id, provider, model, instructions, expected_rate, created_at';

const OUTPUT_COLUMNS = `id, setup_id, substr(input, 1, ${AUTOMATION_OUTPUT_EXCERPT_LENGTH}) AS excerpt, output, error, created_at`;

function setupFromRow(row: AutomationSetupRow): AutomationSetupRecord {
	return {
		id: row.id,
		provider: row.provider,
		model: row.model,
		instructions: row.instructions,
		expectedRate: row.expected_rate,
		createdAt: row.created_at,
	};
}

export function outputFromRow(row: AutomationOutputRow): AutomationOutputRecord {
	return {
		id: row.id,
		setupId: row.setup_id,
		excerpt: row.excerpt,
		output: row.output,
		error: row.error,
		createdAt: row.created_at,
	};
}

export function listAutomationSetups(
	db: MaliniDatabase,
	definitionId: string,
): AutomationSetupRecord[] {
	return all<AutomationSetupRow>(
		db,
		`SELECT ${SETUP_COLUMNS} FROM automation_setups WHERE definition_id = ? ORDER BY created_at, rowid`,
		definitionId,
	).map(setupFromRow);
}

export function latestAutomationSetup(
	db: MaliniDatabase,
	definitionId: string,
): AutomationSetupRecord | null {
	const row = get<AutomationSetupRow>(
		db,
		`SELECT ${SETUP_COLUMNS} FROM automation_setups WHERE definition_id = ?
		 ORDER BY created_at DESC, rowid DESC LIMIT 1`,
		definitionId,
	);
	return row ? setupFromRow(row) : null;
}

export function insertAutomationSetup(
	db: MaliniDatabase,
	definitionId: string,
	setup: AutomationSetupRecord,
): void {
	run(
		db,
		`INSERT INTO automation_setups (id, definition_id, provider, model, instructions, expected_rate, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		setup.id,
		definitionId,
		setup.provider,
		setup.model,
		setup.instructions,
		setup.expectedRate,
		setup.createdAt,
	);
}

export function insertAutomationOutput(
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
		`INSERT INTO automation_outputs (id, definition_id, setup_id, input, output, error, created_at)
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

export function listAutomationOutputs(
	db: MaliniDatabase,
	definitionId: string,
	since: string,
): AutomationOutputRecord[] {
	return all<AutomationOutputRow>(
		db,
		`SELECT ${OUTPUT_COLUMNS} FROM automation_outputs
		 WHERE definition_id = ? AND created_at >= ?
		 ORDER BY created_at DESC, rowid DESC`,
		definitionId,
		since,
	).map(outputFromRow);
}

export function recentAutomationOutputIds(
	db: MaliniDatabase,
	definitionId: string,
	limit: number,
): string[] {
	return all<{ id: string }>(
		db,
		`SELECT id FROM automation_outputs WHERE definition_id = ?
		 ORDER BY created_at DESC, rowid DESC LIMIT ?`,
		definitionId,
		limit,
	).map((row) => row.id);
}

export function automationOutputInput(db: MaliniDatabase, outputId: string): string | null {
	return (
		get<{ input: string }>(db, 'SELECT input FROM automation_outputs WHERE id = ?', outputId)
			?.input ?? null
	);
}
