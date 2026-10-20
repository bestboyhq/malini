import {
	localRepositoriesFromProjects,
	mergeRepositories,
	repositoryContextForWorkstream,
	type ConnectedRepositoryContext,
} from '$shared/repositories/domain/repository-context';
import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';

export { repositoryContextQuery };

class RepositoryContextQuery {
	public readonly data: (workstreamId: string) => ConnectedRepositoryContext | null = $derived(
		(workstreamId: string) => {
			if (!workstreamsAggregate.loaded) return null;
			return repositoryContextForWorkstream({
				repositories: mergeRepositories(
					repositoriesAggregate.items,
					localRepositoriesFromProjects(workstreamsAggregate.projects),
				),
				workstreams: workstreamsAggregate.workstreams,
				workstreamId,
			});
		},
	);
}

const repositoryContextQuery = new RepositoryContextQuery();
