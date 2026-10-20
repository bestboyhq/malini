import type { MaliniDatabase } from '$main/db/driver';
import { get, nowIso8601, run } from '$main/db/rows';

export function readScratchpad(db: MaliniDatabase, repositoryFullName: string): string | null {
	return (
		get<{ content: string }>(
			db,
			'SELECT content FROM scratchpads WHERE repository_full_name = ?',
			repositoryFullName,
		)?.content ?? null
	);
}

export function writeScratchpad(
	db: MaliniDatabase,
	repositoryFullName: string,
	content: string,
): void {
	run(
		db,
		`INSERT INTO scratchpads (repository_full_name, content, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(repository_full_name) DO UPDATE SET
		   content = excluded.content,
		   updated_at = excluded.updated_at`,
		repositoryFullName,
		content,
		nowIso8601(),
	);
}
