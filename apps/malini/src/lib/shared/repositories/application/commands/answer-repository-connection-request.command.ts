import { repositoryConnectionStore } from '$shared/repositories/infrastructure/stores/repository-connection.store.svelte';
import { openRepositoryFolderCommand } from './open-repository-folder.command';

export { answerRepositoryConnectionRequestCommand };

function answerRepositoryConnectionRequestCommand(openCloneDialog: () => void): void {
	const requested = repositoryConnectionStore.requested;
	repositoryConnectionStore.requested = null;
	if (requested === 'folder') openRepositoryFolderCommand();
	if (requested === 'clone') openCloneDialog();
}
