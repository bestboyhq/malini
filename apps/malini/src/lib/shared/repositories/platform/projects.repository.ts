import type { MaliniDatabase } from '$main/db/driver';
import { all, get, run } from '$main/db/rows';
import type { Project } from '$contract/repositories';

export type { Project };

interface ProjectRow {
	id: string;
	name: string;
	repo_path: string;
	default_branch: string;
	created_at: string;
}

const PROJECT_COLUMNS = 'id, name, repo_path, default_branch, created_at';

function projectFromRow(row: ProjectRow): Project {
	return {
		id: row.id,
		name: row.name,
		repoPath: row.repo_path,
		defaultBranch: row.default_branch,
		createdAt: row.created_at,
	};
}

export function upsertProject(db: MaliniDatabase, project: Project): void {
	run(
		db,
		`INSERT INTO projects (id, name, repo_path, default_branch, created_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   name=excluded.name,
		   repo_path=excluded.repo_path,
		   default_branch=excluded.default_branch`,
		project.id,
		project.name,
		project.repoPath,
		project.defaultBranch,
		project.createdAt,
	);
}

export function listProjects(db: MaliniDatabase): Project[] {
	return all<ProjectRow>(
		db,
		`SELECT ${PROJECT_COLUMNS} FROM projects ORDER BY created_at DESC`,
	).map(projectFromRow);
}

export function getProject(db: MaliniDatabase, projectId: string): Project | null {
	const row = get<ProjectRow>(
		db,
		`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ?`,
		projectId,
	);
	return row ? projectFromRow(row) : null;
}

export function deleteProjectWithoutWorkstreams(db: MaliniDatabase, projectId: string): boolean {
	return (
		run(
			db,
			`DELETE FROM projects WHERE id = ?
			 AND NOT EXISTS (SELECT 1 FROM workstreams WHERE project_id = ?)`,
			projectId,
			projectId,
		).changes > 0
	);
}
