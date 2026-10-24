import type { AgentCheckout, AgentLineage } from '$contract/agent';
import type { Workstream } from '$contract/repositories';
import type { MaliniDatabase } from '$main/db/driver';
import { leadScopeOwns, parseLeadScope } from '../domain/lead-scope';
import { repositoryOwner } from '../domain/repository-context';
import { listProjects } from './projects.repository';
import { listRepositoryCatalog, type CatalogRepository } from './repository-catalog';
import { getWorkstream, listWorkstreams } from './workstreams.repository';

export async function workstreamLineage(
	db: MaliniDatabase,
	workstreamId: string,
): Promise<AgentLineage | null> {
	const workstream = getWorkstream(db, workstreamId);
	if (workstream === null) return null;
	const scope = parseLeadScope(workstream.scope);
	const parent = workstream.startedBy === null ? null : getWorkstream(db, workstream.startedBy);
	if (scope === null && parent === null) return null;
	const catalog = await listRepositoryCatalog(db);
	const projects = new Map(listProjects(db).map((project) => [project.id, project]));
	const repositoryCheckouts = (repository: CatalogRepository): AgentCheckout[] =>
		repository.projectIds.flatMap((projectId) => {
			const project = projects.get(projectId);
			return project
				? [
						{
							repository: repository.fullName,
							branch: project.defaultBranch,
							path: project.repoPath,
						},
					]
				: [];
		});
	const workstreamCheckout = (sibling: Workstream): AgentCheckout => ({
		repository:
			catalog.find((repository) => repository.projectIds.includes(sibling.projectId))?.fullName ??
			sibling.projectId,
		branch: sibling.branch,
		path: sibling.path,
	});
	return {
		lead:
			scope === null
				? null
				: {
						owner: scope.kind === 'home' ? null : scope.owner,
						repositories: catalog
							.filter((repository) => leadScopeOwns(scope, repositoryOwner(repository.fullName)))
							.flatMap(repositoryCheckouts),
					},
		startedBy: parent === null ? null : { name: parent.name, lead: parent.scope !== null },
		siblings:
			parent === null
				? []
				: listWorkstreams(db)
						.filter(
							(sibling) =>
								sibling.startedBy === parent.id &&
								sibling.id !== workstream.id &&
								sibling.scope === null,
						)
						.map(workstreamCheckout),
	};
}
