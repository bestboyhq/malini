import type { RepositoryImportSource } from '$shared/repositories/domain/github-auth';
import {
	repositoryConnectFailure,
	repositoryConnectionFor,
} from '$shared/repositories/domain/repository-connection';
import { repositoryIdentityForImportSource } from '$shared/repositories/domain/repository-context';
import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';
import { githubService } from '$shared/repositories/infrastructure/services/github.service';
import { repositoryConnectionStore } from '$shared/repositories/infrastructure/stores/repository-connection.store.svelte';
import { goto } from '$shared/router/navigation';
import { repositoryHref } from '$shared/router/routes-hrefs';
import { prepareRepositoryCommand } from './prepare-repository.command';

export { connectRepositoryCommand };

function connectRepositoryCommand(source: RepositoryImportSource, onConnected?: () => void): void {
	if (repositoryConnectionStore.connecting !== null) return;
	repositoryConnectionStore.connecting = repositoryConnectionFor(source);
	repositoryConnectionStore.error = null;
	void (async () => {
		try {
			const { repo } = await githubService.connectRepository(source);
			prepareRepositoryCommand(repo);
			await repositoriesAggregate.refresh();
			await goto(repositoryHref(repo.id));
			onConnected?.();
		} catch (caught) {
			repositoryConnectionStore.error = repositoryConnectFailure(
				caught,
				'Failed to connect repository',
				repositoryIdentityForImportSource(source).fullName,
			);
		} finally {
			repositoryConnectionStore.connecting = null;
		}
	})();
}
