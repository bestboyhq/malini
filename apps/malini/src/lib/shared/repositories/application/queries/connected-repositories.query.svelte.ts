import type { Repository } from '$shared/repositories/domain/repository';
import {
	localRepositoriesFromProjects,
	mergeRepositories,
} from '$shared/repositories/domain/repository-context';
import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { repositoryRemovalStore } from '$shared/repositories/infrastructure/stores/repository-removal.store.svelte';

export { connectedRepositoriesQuery };

class ConnectedRepositoriesQuery {
	public readonly data: readonly Repository[] = $derived(
		mergeRepositories(
			repositoriesAggregate.items,
			localRepositoriesFromProjects(workstreamsAggregate.projects),
		).filter((repository) => !repositoryRemovalStore.removing.has(repository.id)),
	);
}

const connectedRepositoriesQuery = new ConnectedRepositoriesQuery();
