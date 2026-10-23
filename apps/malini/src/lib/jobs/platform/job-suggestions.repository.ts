import type { JobPromptEvidence, JobSuggestionRecord, JobSuggestionStatus } from '$contract/jobs';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, isRecord, parseJsonColumn, run } from '$main/db/rows';
import { invariant } from '$main/errors';

interface SuggestionRow {
	id: string;
	cluster_key: string;
	status: JobSuggestionStatus;
	evidence_json: string;
	created_at: string;
	updated_at: string;
}

const COLUMNS = 'id, cluster_key, status, evidence_json, created_at, updated_at';

export function insertSuggestionIfAbsent(
	db: MaliniDatabase,
	input: Readonly<{
		id: string;
		clusterKey: string;
		evidence: readonly JobPromptEvidence[];
		createdAt: string;
	}>,
): JobSuggestionRecord | null {
	const { changes } = run(
		db,
		`INSERT OR IGNORE INTO job_suggestions (${COLUMNS}) VALUES (?, ?, 'open', ?, ?, ?)`,
		input.id,
		input.clusterKey,
		JSON.stringify(input.evidence),
		input.createdAt,
		input.createdAt,
	);
	return changes === 0 ? null : getSuggestion(db, input.id);
}

export function getSuggestion(
	db: MaliniDatabase,
	suggestionId: string,
): JobSuggestionRecord | null {
	const row = get<SuggestionRow>(
		db,
		`SELECT ${COLUMNS} FROM job_suggestions WHERE id = ?`,
		suggestionId,
	);
	return row ? fromRow(row) : null;
}

export function listSuggestions(db: MaliniDatabase): JobSuggestionRecord[] {
	return all<SuggestionRow>(
		db,
		`SELECT ${COLUMNS} FROM job_suggestions ORDER BY created_at, id`,
	).map(fromRow);
}

export function setSuggestionStatus(
	db: MaliniDatabase,
	suggestionId: string,
	status: JobSuggestionStatus,
	updatedAt: string,
): JobSuggestionRecord {
	run(
		db,
		'UPDATE job_suggestions SET status = ?, updated_at = ? WHERE id = ?',
		status,
		updatedAt,
		suggestionId,
	);
	const updated = getSuggestion(db, suggestionId);
	if (!updated) throw invariant(`suggestion \`${suggestionId}\` not found`);
	return updated;
}

function fromRow(row: SuggestionRow): JobSuggestionRecord {
	return {
		id: row.id,
		clusterKey: row.cluster_key,
		status: row.status,
		evidence: evidenceOf(parseJsonColumn(row.evidence_json)),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function evidenceOf(value: unknown): JobPromptEvidence[] {
	return Array.isArray(value) ? value.filter(isPromptEvidence) : [];
}

function isPromptEvidence(value: unknown): value is JobPromptEvidence {
	return isRecord(value) && typeof value['text'] === 'string';
}
