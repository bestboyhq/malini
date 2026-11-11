import type {
	AutomationAskRecord,
	AutomationSuggestionRecord,
	AutomationSuggestionStatus,
} from '$contract/automations';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, run } from '$main/db/rows';
import { invariant } from '$main/errors';

export type AutomationAsk = AutomationAskRecord &
	Readonly<{
		id: string;
		mergeEventId: number;
		repositoryId: string;
		sessionId: string;
		runId: string;
	}>;

export type NewAutomationSuggestion = Omit<
	AutomationSuggestionRecord,
	'status' | 'definitionId' | 'asks' | 'updatedAt'
>;

interface AskRow {
	id: string;
	merge_event_id: number;
	repository_id: string;
	workstream_id: string;
	session_id: string;
	run_id: string;
	text: string;
	pull_request_number: number | null;
	asked_at: string;
}

interface SuggestionRow {
	id: string;
	repository_id: string;
	session_id: string;
	after_run_id: string;
	name: string;
	instructions: string;
	trigger_when: string;
	status: AutomationSuggestionStatus;
	definition_id: string | null;
	created_at: string;
	updated_at: string;
}

const ASK_COLUMNS =
	'id, merge_event_id, repository_id, workstream_id, session_id, run_id, text, pull_request_number, asked_at';

const SUGGESTION_COLUMNS =
	'id, repository_id, session_id, after_run_id, name, instructions, trigger_when, status, definition_id, created_at, updated_at';

export function insertAskIfFirst(db: MaliniDatabase, ask: AutomationAsk): boolean {
	return (
		run(
			db,
			`INSERT OR IGNORE INTO automation_asks (${ASK_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			ask.id,
			ask.mergeEventId,
			ask.repositoryId,
			ask.workstreamId,
			ask.sessionId,
			ask.runId,
			ask.text,
			ask.pullRequestNumber,
			ask.askedAt,
		).changes > 0
	);
}

export function listUnsuggestedAsks(
	db: MaliniDatabase,
	repositoryId: string,
	exceptId: string,
	since: string,
	limit: number,
): AutomationAsk[] {
	return all<AskRow>(
		db,
		`SELECT ${ASK_COLUMNS} FROM automation_asks
		 WHERE repository_id = ? AND id != ? AND suggestion_id IS NULL AND asked_at >= ?
		 ORDER BY asked_at DESC, id DESC LIMIT ?`,
		repositoryId,
		exceptId,
		since,
		limit,
	).map(askFromRow);
}

export function deleteUnsuggestedAsksBefore(db: MaliniDatabase, before: string): void {
	run(db, 'DELETE FROM automation_asks WHERE suggestion_id IS NULL AND asked_at < ?', before);
}

export function insertSuggestion(
	db: MaliniDatabase,
	suggestion: NewAutomationSuggestion,
	askIds: readonly string[],
): AutomationSuggestionRecord {
	db.transaction(() => {
		run(
			db,
			`INSERT INTO automation_suggestions (${SUGGESTION_COLUMNS})
			 VALUES (?, ?, ?, ?, ?, ?, ?, 'open', NULL, ?, ?)`,
			suggestion.id,
			suggestion.repositoryId,
			suggestion.sessionId,
			suggestion.afterRunId,
			suggestion.name,
			suggestion.instructions,
			suggestion.when,
			suggestion.createdAt,
			suggestion.createdAt,
		);
		for (const askId of askIds) {
			run(db, 'UPDATE automation_asks SET suggestion_id = ? WHERE id = ?', suggestion.id, askId);
		}
	});
	return requireSuggestion(db, suggestion.id);
}

export function getSuggestion(
	db: MaliniDatabase,
	suggestionId: string,
): AutomationSuggestionRecord | null {
	const row = get<SuggestionRow>(
		db,
		`SELECT ${SUGGESTION_COLUMNS} FROM automation_suggestions WHERE id = ?`,
		suggestionId,
	);
	return row ? suggestionFromRow(db, row) : null;
}

export function listShownSuggestions(db: MaliniDatabase): AutomationSuggestionRecord[] {
	return all<SuggestionRow>(
		db,
		`SELECT ${SUGGESTION_COLUMNS} FROM automation_suggestions
		 WHERE status != 'dismissed' ORDER BY created_at, id`,
	).map((row) => suggestionFromRow(db, row));
}

export function settleSuggestion(
	db: MaliniDatabase,
	suggestionId: string,
	status: Exclude<AutomationSuggestionStatus, 'open'>,
	definitionId: string | null,
	updatedAt: string,
): AutomationSuggestionRecord {
	run(
		db,
		'UPDATE automation_suggestions SET status = ?, definition_id = ?, updated_at = ? WHERE id = ?',
		status,
		definitionId,
		updatedAt,
		suggestionId,
	);
	return requireSuggestion(db, suggestionId);
}

function requireSuggestion(db: MaliniDatabase, suggestionId: string): AutomationSuggestionRecord {
	const suggestion = getSuggestion(db, suggestionId);
	if (!suggestion) throw invariant(`suggestion \`${suggestionId}\` not found`);
	return suggestion;
}

function suggestionFromRow(db: MaliniDatabase, row: SuggestionRow): AutomationSuggestionRecord {
	return {
		id: row.id,
		repositoryId: row.repository_id,
		sessionId: row.session_id,
		afterRunId: row.after_run_id,
		name: row.name,
		instructions: row.instructions,
		when: row.trigger_when,
		status: row.status,
		definitionId: row.definition_id,
		asks: all<AskRow>(
			db,
			`SELECT ${ASK_COLUMNS} FROM automation_asks WHERE suggestion_id = ? ORDER BY asked_at, id`,
			row.id,
		).map(({ text, workstream_id, pull_request_number, asked_at }) => ({
			text,
			workstreamId: workstream_id,
			pullRequestNumber: pull_request_number,
			askedAt: asked_at,
		})),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function askFromRow(row: AskRow): AutomationAsk {
	return {
		id: row.id,
		mergeEventId: row.merge_event_id,
		repositoryId: row.repository_id,
		workstreamId: row.workstream_id,
		sessionId: row.session_id,
		runId: row.run_id,
		text: row.text,
		pullRequestNumber: row.pull_request_number,
		askedAt: row.asked_at,
	};
}

export function listSuggestedBefore(
	db: MaliniDatabase,
	repositoryId: string,
): Pick<AutomationSuggestionRecord, 'name' | 'instructions'>[] {
	return all<{ name: string; instructions: string }>(
		db,
		'SELECT name, instructions FROM automation_suggestions WHERE repository_id = ? ORDER BY created_at',
		repositoryId,
	);
}
