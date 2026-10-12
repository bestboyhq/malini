import {
	localRepositoriesFromProjects,
	mergeRepositories,
	workstreamRepositories,
} from '$shared/repositories/domain/repository-context';
import type { ArchivedWorkstream } from '$shared/repositories/domain/workstream';
import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';

export { archivedWorkstreamsQuery, type ArchivedWorkstreamListing };

type ArchivedWorkstreamListing = ArchivedWorkstream &
	Readonly<{ repositoryFullName: string | null }>;

class ArchivedWorkstreamsQuery {
	public readonly data: readonly ArchivedWorkstreamListing[] = $derived.by(() => {
		const repositories = workstreamRepositories({
			repositories: mergeRepositories(
				repositoriesAggregate.items,
				localRepositoriesFromProjects(workstreamsAggregate.projects),
			),
			workstreams: workstreamsAggregate.archived,
		});
		return workstreamsAggregate.archived.map((workstream) => ({
			...workstream,
			repositoryFullName: repositories.get(workstream.id)?.fullName ?? null,
		}));
	});
}

const archivedWorkstreamsQuery = new ArchivedWorkstreamsQuery();
