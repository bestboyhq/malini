import type { MaliniDatabase } from '$main/db/driver';
import { all, get, run } from '$main/db/rows';

export interface ConnectedRepository {
	id: string;
	fullName: string;
	defaultBranch: string;
	localPath: string | null;
	remoteUrl: string | null;
	createdAt: string;
}

interface ConnectedRepositoryRow {
	id: string;
	full_name: string;
	default_branch: string;
	local_path: string | null;
	remote_url: string | null;
	created_at: string;
}

const COLUMNS = 'id, full_name, default_branch, local_path, remote_url, created_at';

function fromRow(row: ConnectedRepositoryRow): ConnectedRepository {
	return {
		id: row.id,
		fullName: row.full_name,
		defaultBranch: row.default_branch,
		localPath: row.local_path,
		remoteUrl: row.remote_url,
		createdAt: row.created_at,
	};
}

export function upsertConnectedRepository(
	db: MaliniDatabase,
	repository: ConnectedRepository,
): void {
	run(
		db,
		`INSERT INTO connected_repositories (${COLUMNS})
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   full_name=excluded.full_name,
		   default_branch=excluded.default_branch,
		   local_path=excluded.local_path,
		   remote_url=excluded.remote_url`,
		repository.id,
		repository.fullName,
		repository.defaultBranch,
		repository.localPath,
		repository.remoteUrl,
		repository.createdAt,
	);
}

export function listConnectedRepositories(db: MaliniDatabase): ConnectedRepository[] {
	return all<ConnectedRepositoryRow>(
		db,
		`SELECT ${COLUMNS} FROM connected_repositories ORDER BY created_at DESC, id DESC`,
	).map(fromRow);
}

export function getConnectedRepository(db: MaliniDatabase, id: string): ConnectedRepository | null {
	const row = get<ConnectedRepositoryRow>(
		db,
		`SELECT ${COLUMNS} FROM connected_repositories WHERE id = ?`,
		id,
	);
	return row ? fromRow(row) : null;
}

export function findConnectedRepositoryByFullName(
	db: MaliniDatabase,
	fullName: string,
	exceptId?: string,
): ConnectedRepository | null {
	const row = get<ConnectedRepositoryRow>(
		db,
		`SELECT ${COLUMNS} FROM connected_repositories
		 WHERE lower(full_name) = lower(?) AND id != ?`,
		fullName,
		exceptId ?? '',
	);
	return row ? fromRow(row) : null;
}

export function deleteConnectedRepository(db: MaliniDatabase, id: string): boolean {
	return run(db, 'DELETE FROM connected_repositories WHERE id = ?', id).changes > 0;
}
