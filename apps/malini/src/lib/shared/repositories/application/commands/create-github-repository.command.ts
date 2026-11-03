import type { GithubRepository, NewGithubRepository } from '$shared/repositories/domain/repository';
import {
	repositoryConnectFailure,
	type RepositoryConnectOptions,
} from '$shared/repositories/domain/repository-connection';
import { githubRepositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/github-repositories.aggregate.svelte';
import { githubService } from '$shared/repositories/infrastructure/services/github.service';
import { repositoryConnectionStore } from '$shared/repositories/infrastructure/stores/repository-connection.store.svelte';
import { connectRepositoryCommand } from './connect-repository.command';

export { createGithubRepositoryCommand };

function createGithubRepositoryCommand(
	request: NewGithubRepository,
	options: RepositoryConnectOptions = {},
): void {
	if (repositoryConnectionStore.connecting !== null) return;
	const fullName = `${request.owner}/${request.name}`;
	repositoryConnectionStore.connecting = { kind: 'create', key: `create:${fullName}` };
	repositoryConnectionStore.error = null;
	void (async () => {
		let created: GithubRepository | null = null;
		try {
			created = await githubService.createGithubRepository(request);
			githubRepositoriesAggregate.add(created);
		} catch (caught) {
			repositoryConnectionStore.error = repositoryConnectFailure(
				caught,
				'Failed to create repository',
				fullName,
			);
		} finally {
			repositoryConnectionStore.connecting = null;
		}
		if (created) connectRepositoryCommand({ kind: 'clone-url', url: created.cloneUrl }, options);
	})();
}
