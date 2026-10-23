import type { RepositoryConnectingKind } from '$shared/repositories/domain/repository-connection';
import { repositoryConnectionStore } from '$shared/repositories/infrastructure/stores/repository-connection.store.svelte';

export { repositoryConnectionRequestedQuery };

class RepositoryConnectionRequestedQuery {
	public readonly data: RepositoryConnectingKind | null = $derived(
		repositoryConnectionStore.requested,
	);
}

const repositoryConnectionRequestedQuery = new RepositoryConnectionRequestedQuery();
