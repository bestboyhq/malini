import { DatabaseSync, type StatementSync } from 'node:sqlite';

export interface MaliniDatabase {
	readonly path: string;
	exec(sql: string): void;
	prepare(sql: string): StatementSync;
	transaction<T>(run: () => T): T;
	sqliteVersion(): string;
	releaseFreePages(): void;
	close(): void;
}

const INCREMENTAL_AUTO_VACUUM = 2;

export function openDatabase(path: string): MaliniDatabase {
	const db = new DatabaseSync(path);
	db.exec('PRAGMA foreign_keys = ON;');
	if (path !== ':memory:') {
		db.exec('PRAGMA journal_mode = WAL;');
		db.exec('PRAGMA synchronous = NORMAL;');
	}
	const pragma = (name: string): unknown => db.prepare(`PRAGMA ${name}`).get()?.[name];

	return {
		path,
		exec: (sql) => db.exec(sql),
		prepare: (sql) => db.prepare(sql),
		transaction: (run) => {
			db.exec('BEGIN');
			try {
				const result = run();
				db.exec('COMMIT');
				return result;
			} catch (error) {
				db.exec('ROLLBACK');
				throw error;
			}
		},
		sqliteVersion: () => {
			const row = db.prepare('SELECT sqlite_version() AS version').get() as { version: string };
			return row.version;
		},
		releaseFreePages: () => {
			if (pragma('auto_vacuum') !== INCREMENTAL_AUTO_VACUUM) {
				db.exec('PRAGMA auto_vacuum = INCREMENTAL; VACUUM;');
			} else if (pragma('freelist_count') !== 0) {
				db.exec('PRAGMA incremental_vacuum;');
			} else {
				return;
			}
			db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
		},
		close: () => db.close(),
	};
}
