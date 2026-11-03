import type { RepositoryConnection } from '$shared/repositories/domain/repository-connection';
import { repositoryConnectionStore } from '$shared/repositories/infrastructure/stores/repository-connection.store.svelte';

export { repositoryConnectingQuery };

class RepositoryConnectingQuery {
	public readonly data: RepositoryConnection['kind'] | null = $derived(
		repositoryConnectionStore.connecting?.kind ?? null,
	);
}

const repositoryConnectingQuery = new RepositoryConnectingQuery();
