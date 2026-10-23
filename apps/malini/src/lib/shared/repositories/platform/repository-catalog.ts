import type { MaliniDatabase } from '$main/db/driver';
import type { Repository } from '../domain/repository';
import {
	localRepositoriesFromProjects,
	mergeRepositories,
	repositoryProjectIds,
} from '../domain/repository-context';
import { listConnectedRepositories } from './connected-repositories.repository';
import { listHiddenRepositoryIds } from './hidden-repositories.repository';
import { listProjects } from './projects.repository';
import { projectDto } from './workstream-dto';

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
