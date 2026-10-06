import { repositoryConnectionStore } from '$shared/repositories/infrastructure/stores/repository-connection.store.svelte';

export { clearRepositoryConnectErrorCommand };

function clearRepositoryConnectErrorCommand(): void {
	repositoryConnectionStore.error = null;
}
