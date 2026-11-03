import { repositoryConnectionStore } from '$shared/repositories/infrastructure/stores/repository-connection.store.svelte';

export { repositoryFolderRequestedQuery };

class RepositoryFolderRequestedQuery {
	public readonly data: boolean = $derived(repositoryConnectionStore.folderRequested);
}

const repositoryFolderRequestedQuery = new RepositoryFolderRequestedQuery();
