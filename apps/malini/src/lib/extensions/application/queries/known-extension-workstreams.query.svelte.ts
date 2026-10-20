import type { ExtensionWorkstream } from '@malini/extension-api';
import {
	activeWorkstreamsQuery,
	isWorkstreamCheckoutUsable,
	repositoriesScopeReadyQuery,
	repositoryContextQuery,
	workstreamProjectQuery,
	worktreePendingQuery,
} from '$shared/repositories/repositories.api';

class KnownExtensionWorkstreamsQuery {
	public readonly data: readonly ExtensionWorkstream[] = $derived(
		(repositoriesScopeReadyQuery.data ? activeWorkstreamsQuery.data : []).flatMap((workstream) => {
			if (worktreePendingQuery.data(workstream.id) || !isWorkstreamCheckoutUsable(workstream)) {
				return [];
			}
			const project = workstreamProjectQuery.data(workstream.id);
			const repositoryFullName = repositoryContextQuery.data(workstream.id)?.repo.fullName;
			return [
				{
					id: workstream.id,
					path: workstream.path,
					repositoryPath: workstream.path,
					...(project?.repoPath ? { repositoryRootPath: project.repoPath } : {}),
					...(repositoryFullName ? { repositoryFullName } : {}),
					branch: workstream.branch,
					baseBranch: workstream.baseBranch,
				},
			];
		}),
	);

	public readonly read = (): readonly ExtensionWorkstream[] => this.data;
}

export const knownExtensionWorkstreamsQuery = new KnownExtensionWorkstreamsQuery();
