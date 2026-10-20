import type { MaliniDatabase } from './driver';
import { upsertProject } from '$shared/repositories/repositories.platform';
import { upsertWorkstream } from '$shared/repositories/repositories.platform';

export function seedWorkstream(
	db: MaliniDatabase,
	workstreamId: string,
	createdAt = '2026-07-22T00:00:00Z',
): void {
	const projectId = `project-${workstreamId}`;
	upsertProject(db, {
		id: projectId,
		name: projectId,
		repoPath: `/tmp/${projectId}`,
		defaultBranch: 'main',
		createdAt,
	});
	upsertWorkstream(db, {
		id: workstreamId,
		projectId,
		name: workstreamId,
		path: `/tmp/${workstreamId}`,
		branch: `malini/${workstreamId}`,
		baseBranch: 'main',
		status: 'active',
		createdAt,
	});
}
