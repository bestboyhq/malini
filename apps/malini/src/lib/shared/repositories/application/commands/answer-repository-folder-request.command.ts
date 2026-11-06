import type { RepositoryConnectOptions } from '$shared/repositories/domain/repository-connection';
import { repositoryConnectionStore } from '$shared/repositories/infrastructure/stores/repository-connection.store.svelte';
import { openRepositoryFolderCommand } from './open-repository-folder.command';

export { answerRepositoryFolderRequestCommand };

function answerRepositoryFolderRequestCommand(options: RepositoryConnectOptions = {}): void {
	if (!repositoryConnectionStore.folderRequested) return;
	repositoryConnectionStore.folderRequested = false;
	openRepositoryFolderCommand(options);
}
