import {
	localRepositoriesFromProjects,
	mergeRepositories,
	workstreamRepositories,
} from '$shared/repositories/domain/repository-context';
import { displayWorkstreamName } from '$shared/repositories/domain/workstream-names';
import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';

export { workstreamNameQuery };

class WorkstreamNameQuery {
	public readonly data: (workstreamId: string) => string | null = $derived(
		(workstreamId: string) => {
			const { workstreams, archived, projects } = workstreamsAggregate;
			const workstream =
				workstreams.find((entry) => entry.id === workstreamId) ??
				archived.find((entry) => entry.id === workstreamId);
			if (!workstream) return null;
			const repository = workstreamRepositories({
				repositories: mergeRepositories(
					repositoriesAggregate.items,
					localRepositoriesFromProjects(projects),
				),
				workstreams: [workstream],
			}).get(workstreamId);
			return displayWorkstreamName(workstream, repository?.fullName);
		},
	);
}

const workstreamNameQuery = new WorkstreamNameQuery();
