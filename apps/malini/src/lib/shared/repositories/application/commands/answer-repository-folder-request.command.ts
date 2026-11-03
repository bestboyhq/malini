import { repositoryConnectionStore } from '$shared/repositories/infrastructure/stores/repository-connection.store.svelte';
import { openRepositoryFolderCommand } from './open-repository-folder.command';

export { answerRepositoryFolderRequestCommand };

function answerRepositoryFolderRequestCommand(): void {
	if (!repositoryConnectionStore.folderRequested) return;
	repositoryConnectionStore.folderRequested = false;
	openRepositoryFolderCommand();
}
