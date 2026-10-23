import type { Repository } from '$shared/repositories/domain/repository';
import type { RepositoryPreparation } from '$shared/repositories/domain/repository-connection';
import { repositoryProjectIds } from '$shared/repositories/domain/repository-context';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { repositoryConnectionStore } from '$shared/repositories/infrastructure/stores/repository-connection.store.svelte';

export { repositoryPreparationQuery };

class RepositoryPreparationQuery {
	public readonly data: (repository: Repository) => RepositoryPreparation = $derived(
		(repository: Repository) => {
			if (repositoryConnectionStore.preparing.has(repository.id)) return { kind: 'preparing' };
			const failure = repositoryConnectionStore.preparationFailures.get(repository.id);
			if (!failure || repositoryProjectIds(repository, workstreamsAggregate.projects).length > 0) {
				return { kind: 'ready' };
			}
			return { kind: 'failed', failure };
		},
	);
}

const repositoryPreparationQuery = new RepositoryPreparationQuery();
