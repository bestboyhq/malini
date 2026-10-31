import type { MaliniDatabase } from '$main/db/driver';
import { all, get, run } from '$main/db/rows';

export type SecretRequestRecord = Readonly<{
	id: string;
	sessionId: string;
	names: readonly string[];
	why: string;
	repository: string | null;
	askedAt: string;
	open: boolean;
}>;

export type SecretRequestEnd = 'saved' | 'dismissed' | 'replaced';

interface SecretRequestRow {
	id: string;
	session_id: string;
	names: string;
	why: string;
	repository: string | null;
	asked_at: string;
	settled: SecretRequestEnd | null;
}

const COLUMNS = 'id, session_id, names, why, repository, asked_at, settled';

export function insertSecretRequest(
	db: MaliniDatabase,
	request: Omit<SecretRequestRecord, 'open'>,
): void {
	run(
		db,
		`INSERT INTO secret_requests (id, session_id, names, why, repository, asked_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		request.id,
		request.sessionId,
		JSON.stringify(request.names),
		request.why,
		request.repository,
		request.askedAt,
	);
}

export function openSecretRequests(db: MaliniDatabase, sessionId: string): SecretRequestRecord[] {
	return all<SecretRequestRow>(
		db,
		`SELECT ${COLUMNS} FROM secret_requests WHERE session_id = ? AND settled IS NULL
		 ORDER BY asked_at, rowid`,
		sessionId,
	).map(fromRow);
}

export function getSecretRequest(db: MaliniDatabase, id: string): SecretRequestRecord | null {
	const row = get<SecretRequestRow>(db, `SELECT ${COLUMNS} FROM secret_requests WHERE id = ?`, id);
	return row ? fromRow(row) : null;
}

export function settleSecretRequest(
	db: MaliniDatabase,
	id: string,
	end: SecretRequestEnd,
	at: string,
): boolean {
	return (
		run(
			db,
			`UPDATE secret_requests SET settled = ?, settled_at = ?
			 WHERE id = ? AND settled IS NULL`,
			end,
			at,
			id,
		).changes > 0
	);
}

function fromRow(row: SecretRequestRow): SecretRequestRecord {
	const names: unknown = JSON.parse(row.names);
	return {
		id: row.id,
		sessionId: row.session_id,
		names: Array.isArray(names)
			? names.filter((name: unknown): name is string => typeof name === 'string')
			: [],
		why: row.why,
		repository: row.repository,
		askedAt: row.asked_at,
		open: row.settled === null,
	};
}
