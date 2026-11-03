import { repositoryConnectionStore } from '$shared/repositories/infrastructure/stores/repository-connection.store.svelte';

export { repositoryConnectingKeyQuery };

class RepositoryConnectingKeyQuery {
	public readonly data: string | null = $derived(repositoryConnectionStore.connecting?.key ?? null);
}

const repositoryConnectingKeyQuery = new RepositoryConnectingKeyQuery();
