import type { MaliniDatabase } from '$main/db/driver';
import { all, nowIso8601, run } from '$main/db/rows';

export function listHiddenRepositoryIds(db: MaliniDatabase): string[] {
	return all<{ repository_id: string }>(
		db,
		'SELECT repository_id FROM hidden_repositories ORDER BY hidden_at, repository_id',
	).map((row) => row.repository_id);
}

export function setRepositoryHidden(
	db: MaliniDatabase,
	repositoryId: string,
	hidden: boolean,
): void {
	if (hidden) {
		run(
			db,
			'INSERT INTO hidden_repositories (repository_id, hidden_at) VALUES (?, ?) ON CONFLICT DO NOTHING',
			repositoryId,
			nowIso8601(),
		);
		return;
	}
	run(db, 'DELETE FROM hidden_repositories WHERE repository_id = ?', repositoryId);
}
