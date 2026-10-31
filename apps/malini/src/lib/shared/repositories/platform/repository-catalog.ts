import type { MaliniDatabase } from '$main/db/driver';
import type { Repository } from '../domain/repository';
import {
	localRepositoriesFromProjects,
	mergeRepositories,
	repositoryProjectIds,
} from '../domain/repository-context';
import { listConnectedRepositories } from './connected-repositories.repository';
import { listHiddenRepositoryIds } from './hidden-repositories.repository';
import { getProject, listProjects } from './projects.repository';
import { projectDto } from './workstream-dto';
import { getWorkstream } from './workstreams.repository';

export type CatalogRepository = Repository &
	Readonly<{ projectIds: readonly string[]; hidden: boolean }>;

export async function listRepositoryCatalog(db: MaliniDatabase): Promise<CatalogRepository[]> {
	const projects = await Promise.all(listProjects(db).map(projectDto));
	const hidden = new Set(listHiddenRepositoryIds(db));
	return mergeRepositories(
		listConnectedRepositories(db),
		localRepositoriesFromProjects(projects),
	).map((repository) => ({
		...repository,
		projectIds: repositoryProjectIds(repository, projects),
		hidden: hidden.has(repository.id),
	}));
}

export async function workstreamRepositoryName(
	db: MaliniDatabase,
	workstreamId: string,
): Promise<string | null> {
	const workstream = getWorkstream(db, workstreamId);
	const project = workstream?.scope === null ? getProject(db, workstream.projectId) : null;
	if (!project) return null;
	const projects = [await projectDto(project)];
	return (
		mergeRepositories(listConnectedRepositories(db), localRepositoriesFromProjects(projects)).find(
			(repository) => repositoryProjectIds(repository, projects).length > 0,
		)?.fullName ?? null
	);
}
