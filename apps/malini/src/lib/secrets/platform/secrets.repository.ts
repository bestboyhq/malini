import type { SavedSecret } from '$contract/secrets';
import type { MaliniDatabase } from '$main/db/driver';
import { all, run } from '$main/db/rows';

const EVERYWHERE = '';

export type SealedSecret = Readonly<{ name: string; sealed: Uint8Array }>;

export function upsertSecret(
	db: MaliniDatabase,
	repository: string | null,
	name: string,
	sealed: Uint8Array,
	savedAt: string,
): void {
	run(
		db,
		`INSERT INTO secrets (repository, name, sealed, saved_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT (repository, name) DO UPDATE SET
		   sealed = excluded.sealed,
		   saved_at = excluded.saved_at`,
		repository ?? EVERYWHERE,
		name,
		sealed,
		savedAt,
	);
}

export function deleteSecret(db: MaliniDatabase, repository: string | null, name: string): boolean {
	return (
		run(db, 'DELETE FROM secrets WHERE repository = ? AND name = ?', repository ?? EVERYWHERE, name)
			.changes > 0
	);
}

export function listSecrets(db: MaliniDatabase): SavedSecret[] {
	return all<{ repository: string; name: string; saved_at: string }>(
		db,
		'SELECT repository, name, saved_at FROM secrets ORDER BY repository COLLATE NOCASE, name',
	).map((row) => ({
		name: row.name,
		repository: row.repository === EVERYWHERE ? null : row.repository,
		savedAt: row.saved_at,
	}));
}

export function sealedSecretsReaching(
	db: MaliniDatabase,
	repository: string | null,
): SealedSecret[] {
	return all<{ name: string; sealed: Uint8Array }>(
		db,
		`SELECT name, sealed FROM secrets WHERE repository IN (?, ?)
		 ORDER BY repository = ? DESC`,
		EVERYWHERE,
		repository ?? EVERYWHERE,
		EVERYWHERE,
	);
}
