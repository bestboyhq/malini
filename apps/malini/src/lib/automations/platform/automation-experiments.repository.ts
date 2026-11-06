import type { AutomationExperimentResult, AutomationOutputRecord } from '$contract/automations';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, intToBool, run } from '$main/db/rows';
import {
	AUTOMATION_OUTPUT_EXCERPT_LENGTH,
	outputFromRow,
	type AutomationOutputRow,
} from './automation-outputs.repository';

export type StoredAutomationExperiment = Readonly<{
	id: string;
	definitionId: string;
	name: string;
	provider: string;
	model: string;
	instructions: string;
	current: boolean;
	createdAt: string;
}>;

interface AutomationExperimentRow {
	id: string;
	definition_id: string;
	name: string;
	provider: string;
	model: string;
	instructions: string;
	current: number;
	created_at: string;
}

const EXPERIMENT_COLUMNS =
	'id, definition_id, name, provider, model, instructions, current, created_at';

function experimentFromRow(row: AutomationExperimentRow): StoredAutomationExperiment {
	return {
		id: row.id,
		definitionId: row.definition_id,
		name: row.name,
		provider: row.provider,
		model: row.model,
		instructions: row.instructions,
		current: intToBool(row.current),
		createdAt: row.created_at,
	};
}

export function listAutomationExperiments(
	db: MaliniDatabase,
	definitionId: string,
): StoredAutomationExperiment[] {
	return all<AutomationExperimentRow>(
		db,
		`SELECT ${EXPERIMENT_COLUMNS} FROM automation_experiments WHERE definition_id = ?
		 ORDER BY current DESC, created_at, rowid`,
		definitionId,
	).map(experimentFromRow);
}

export function getAutomationExperiment(
	db: MaliniDatabase,
	id: string,
): StoredAutomationExperiment | null {
	const row = get<AutomationExperimentRow>(
		db,
		`SELECT ${EXPERIMENT_COLUMNS} FROM automation_experiments WHERE id = ?`,
		id,
	);
	return row ? experimentFromRow(row) : null;
}

export function insertAutomationExperiment(
	db: MaliniDatabase,
	experiment: StoredAutomationExperiment,
): void {
	run(
		db,
		`INSERT INTO automation_experiments (${EXPERIMENT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		experiment.id,
		experiment.definitionId,
		experiment.name,
		experiment.provider,
		experiment.model,
		experiment.instructions,
		experiment.current ? 1 : 0,
		experiment.createdAt,
	);
}

export function updateAutomationExperimentSetup(
	db: MaliniDatabase,
	id: string,
	setup: Readonly<{ provider: string; model: string; instructions: string }>,
): void {
	db.transaction(() => {
		run(
			db,
			'UPDATE automation_experiments SET provider = ?, model = ?, instructions = ? WHERE id = ?',
			setup.provider,
			setup.model,
			setup.instructions,
			id,
		);
		run(db, 'DELETE FROM automation_experiment_results WHERE experiment_id = ?', id);
	});
}

export function deleteAutomationExperiment(db: MaliniDatabase, id: string): void {
	run(db, 'DELETE FROM automation_experiments WHERE id = ?', id);
}

export function clearAutomationExperiments(db: MaliniDatabase, definitionId: string): void {
	db.transaction(() => {
		run(db, 'DELETE FROM automation_experiments WHERE definition_id = ?', definitionId);
		run(db, 'DELETE FROM automation_experiment_samples WHERE definition_id = ?', definitionId);
	});
}

export function listAutomationExperimentSample(
	db: MaliniDatabase,
	definitionId: string,
): AutomationOutputRecord[] {
	return all<AutomationOutputRow>(
		db,
		`SELECT outputs.id, outputs.setup_id,
		   substr(outputs.input, 1, ${AUTOMATION_OUTPUT_EXCERPT_LENGTH}) AS excerpt,
		   outputs.output, outputs.error, outputs.created_at
		 FROM automation_experiment_samples AS samples
		 JOIN automation_outputs AS outputs ON outputs.id = samples.output_id
		 WHERE samples.definition_id = ?
		 ORDER BY samples.position`,
		definitionId,
	).map(outputFromRow);
}

export function insertAutomationExperimentSample(
	db: MaliniDatabase,
	definitionId: string,
	outputIds: readonly string[],
): void {
	db.transaction(() => {
		outputIds.forEach((outputId, position) =>
			run(
				db,
				'INSERT INTO automation_experiment_samples (definition_id, output_id, position) VALUES (?, ?, ?)',
				definitionId,
				outputId,
				position,
			),
		);
	});
}

export function listAutomationExperimentResults(
	db: MaliniDatabase,
	experimentId: string,
): AutomationExperimentResult[] {
	return all<{ output_id: string; output: string | null; error: string | null }>(
		db,
		`SELECT results.output_id, results.output, results.error
		 FROM automation_experiment_results AS results
		 JOIN automation_experiment_samples AS samples ON samples.output_id = results.output_id
		 JOIN automation_experiments AS experiments
		   ON experiments.id = results.experiment_id AND experiments.definition_id = samples.definition_id
		 WHERE results.experiment_id = ?
		 ORDER BY samples.position`,
		experimentId,
	).map((row) => ({ outputId: row.output_id, output: row.output, error: row.error }));
}

export function saveAutomationExperimentResult(
	db: MaliniDatabase,
	experimentId: string,
	result: AutomationExperimentResult,
	createdAt: string,
): void {
	run(
		db,
		`INSERT INTO automation_experiment_results (experiment_id, output_id, output, error, created_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT (experiment_id, output_id)
		 DO UPDATE SET output = excluded.output, error = excluded.error, created_at = excluded.created_at`,
		experimentId,
		result.outputId,
		result.output,
		result.error,
		createdAt,
	);
}

export function clearAutomationExperimentResults(db: MaliniDatabase, experimentId: string): void {
	run(db, 'DELETE FROM automation_experiment_results WHERE experiment_id = ?', experimentId);
}
