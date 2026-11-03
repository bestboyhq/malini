import { repositoryConnectionStore } from '$shared/repositories/infrastructure/stores/repository-connection.store.svelte';
import { goto } from '$shared/router/navigation';
import { REPOSITORIES_HREF } from '$shared/router/routes-hrefs';

export { requestRepositoryFolderCommand };

function requestRepositoryFolderCommand(): void {
	repositoryConnectionStore.folderRequested = true;
	void goto(REPOSITORIES_HREF);
}
