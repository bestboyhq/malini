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
	Readonly<{ repositoryId: string | null; repositoryFullName: string | null }>;

class ArchivedWorkstreamsQuery {
	public readonly data: readonly ArchivedWorkstreamListing[] = $derived.by(() => {
		const repositories = workstreamRepositories({
			repositories: mergeRepositories(
				repositoriesAggregate.items,
				localRepositoriesFromProjects(workstreamsAggregate.projects),
			),
			workstreams: workstreamsAggregate.archived,
		});
		return workstreamsAggregate.archived.map((workstream) => {
			const repository = repositories.get(workstream.id);
			return {
				...workstream,
				repositoryId: repository?.id ?? null,
				repositoryFullName: repository?.fullName ?? null,
			};
		});
	});
}

const archivedWorkstreamsQuery = new ArchivedWorkstreamsQuery();
