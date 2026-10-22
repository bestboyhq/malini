import {
	localRepositoriesFromProjects,
	mergeRepositories,
	repositoryContextForWorkstream,
} from '$shared/repositories/domain/repository-context';
import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { page } from '$shared/router/state';
import { createWorkstreamForRepositoryCommand } from './create-workstream-for-repository.command';

export { createWorkstreamHereCommand };

function createWorkstreamHereCommand(): void {
	const { workstreamId, repositoryId } = page.params;
	const repositories = mergeRepositories(
		repositoriesAggregate.items,
		localRepositoriesFromProjects(workstreamsAggregate.projects),
	);
	const repo = workstreamId
		? repositoryContextForWorkstream({
				repositories,
				workstreams: workstreamsAggregate.workstreams,
				workstreamId,
			})?.repo
		: repositories.find(({ id }) => id === repositoryId);
	if (repo) createWorkstreamForRepositoryCommand(repo);
}
