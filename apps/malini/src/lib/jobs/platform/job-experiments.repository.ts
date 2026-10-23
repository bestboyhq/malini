import type { JobExperimentResult, JobOutputRecord } from '$contract/jobs';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, intToBool, run } from '$main/db/rows';
import {
	JOB_OUTPUT_EXCERPT_LENGTH,
	outputFromRow,
	type JobOutputRow,
} from './job-outputs.repository';

export type StoredJobExperiment = Readonly<{
	id: string;
	definitionId: string;
	name: string;
	model: string;
	instructions: string;
	current: boolean;
	createdAt: string;
}>;

interface JobExperimentRow {
	id: string;
	definition_id: string;
	name: string;
	model: string;
	instructions: string;
	current: number;
	created_at: string;
}

const EXPERIMENT_COLUMNS = 'id, definition_id, name, model, instructions, current, created_at';

function experimentFromRow(row: JobExperimentRow): StoredJobExperiment {
	return {
		id: row.id,
		definitionId: row.definition_id,
		name: row.name,
		model: row.model,
		instructions: row.instructions,
		current: intToBool(row.current),
		createdAt: row.created_at,
	};
}

export function listJobExperiments(
	db: MaliniDatabase,
	definitionId: string,
): StoredJobExperiment[] {
	return all<JobExperimentRow>(
		db,
		`SELECT ${EXPERIMENT_COLUMNS} FROM job_experiments WHERE definition_id = ?
		 ORDER BY current DESC, created_at, rowid`,
		definitionId,
	).map(experimentFromRow);
}

export function getJobExperiment(db: MaliniDatabase, id: string): StoredJobExperiment | null {
	const row = get<JobExperimentRow>(
		db,
		`SELECT ${EXPERIMENT_COLUMNS} FROM job_experiments WHERE id = ?`,
		id,
	);
	return row ? experimentFromRow(row) : null;
}

export function insertJobExperiment(db: MaliniDatabase, experiment: StoredJobExperiment): void {
	run(
		db,
		`INSERT INTO job_experiments (${EXPERIMENT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		experiment.id,
		experiment.definitionId,
		experiment.name,
		experiment.model,
		experiment.instructions,
		experiment.current ? 1 : 0,
		experiment.createdAt,
	);
}

export function updateJobExperimentSetup(
	db: MaliniDatabase,
	id: string,
	setup: Readonly<{ model: string; instructions: string }>,
): void {
	db.transaction(() => {
		run(
			db,
			'UPDATE job_experiments SET model = ?, instructions = ? WHERE id = ?',
			setup.model,
			setup.instructions,
			id,
		);
		run(db, 'DELETE FROM job_experiment_results WHERE experiment_id = ?', id);
	});
}

export function deleteJobExperiment(db: MaliniDatabase, id: string): void {
	run(db, 'DELETE FROM job_experiments WHERE id = ?', id);
}

export function clearJobExperiments(db: MaliniDatabase, definitionId: string): void {
	db.transaction(() => {
		run(db, 'DELETE FROM job_experiments WHERE definition_id = ?', definitionId);
		run(db, 'DELETE FROM job_experiment_samples WHERE definition_id = ?', definitionId);
	});
}

export function listJobExperimentSample(
	db: MaliniDatabase,
	definitionId: string,
): JobOutputRecord[] {
	return all<JobOutputRow>(
		db,
		`SELECT outputs.id, outputs.setup_id,
		   substr(outputs.input, 1, ${JOB_OUTPUT_EXCERPT_LENGTH}) AS excerpt,
		   outputs.output, outputs.error, outputs.created_at
		 FROM job_experiment_samples AS samples
		 JOIN job_outputs AS outputs ON outputs.id = samples.output_id
		 WHERE samples.definition_id = ?
		 ORDER BY samples.position`,
		definitionId,
	).map(outputFromRow);
}

export function insertJobExperimentSample(
	db: MaliniDatabase,
	definitionId: string,
	outputIds: readonly string[],
): void {
	db.transaction(() => {
		outputIds.forEach((outputId, position) =>
			run(
				db,
				'INSERT INTO job_experiment_samples (definition_id, output_id, position) VALUES (?, ?, ?)',
				definitionId,
				outputId,
				position,
			),
		);
	});
}

export function listJobExperimentResults(
	db: MaliniDatabase,
	experimentId: string,
): JobExperimentResult[] {
	return all<{ output_id: string; output: string | null; error: string | null }>(
		db,
		`SELECT results.output_id, results.output, results.error
		 FROM job_experiment_results AS results
		 JOIN job_experiment_samples AS samples ON samples.output_id = results.output_id
		 JOIN job_experiments AS experiments
		   ON experiments.id = results.experiment_id AND experiments.definition_id = samples.definition_id
		 WHERE results.experiment_id = ?
		 ORDER BY samples.position`,
		experimentId,
	).map((row) => ({ outputId: row.output_id, output: row.output, error: row.error }));
}

export function saveJobExperimentResult(
	db: MaliniDatabase,
	experimentId: string,
	result: JobExperimentResult,
	createdAt: string,
): void {
	run(
		db,
		`INSERT INTO job_experiment_results (experiment_id, output_id, output, error, created_at)
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

export function clearJobExperimentResults(db: MaliniDatabase, experimentId: string): void {
	run(db, 'DELETE FROM job_experiment_results WHERE experiment_id = ?', experimentId);
}
