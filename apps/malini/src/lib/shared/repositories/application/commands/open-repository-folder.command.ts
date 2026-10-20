import { repositoryConnectFailure } from '$shared/repositories/domain/repository-connection';
import { githubService } from '$shared/repositories/infrastructure/services/github.service';
import { repositoryConnectionStore } from '$shared/repositories/infrastructure/stores/repository-connection.store.svelte';
import { connectRepositoryCommand } from './connect-repository.command';

export { openRepositoryFolderCommand };

function openRepositoryFolderCommand(): void {
	if (repositoryConnectionStore.connecting !== null) return;
	void (async () => {
		let path: string | null;
		try {
			path = await githubService.pickRepositoryFolder();
		} catch (caught) {
			repositoryConnectionStore.error = repositoryConnectFailure(
				caught,
				'The folder picker could not open',
			);
			return;
		}
		if (!path) return;
		connectRepositoryCommand({ kind: 'local-folder', path });
	})();
}
