import type { RepositoryConnectFailure } from '$shared/repositories/domain/repository-connection';
import { repositoryConnectionStore } from '$shared/repositories/infrastructure/stores/repository-connection.store.svelte';

export { repositoryConnectErrorQuery };

class RepositoryConnectErrorQuery {
	public readonly data: RepositoryConnectFailure | null = $derived(repositoryConnectionStore.error);
}

const repositoryConnectErrorQuery = new RepositoryConnectErrorQuery();
