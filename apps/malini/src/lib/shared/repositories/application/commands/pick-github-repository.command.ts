import type { GithubRepository } from '$shared/repositories/domain/repository';
import type {
	GithubRepositoryState,
	RepositoryConnectOptions,
} from '$shared/repositories/domain/repository-connection';
import { goto } from '$shared/router/navigation';
import { repositoryHref } from '$shared/router/routes-hrefs';
import { connectRepositoryCommand } from './connect-repository.command';
import { createWorkstreamForRepositoryCommand } from './create-workstream-for-repository.command';
import { prepareRepositoryCommand } from './prepare-repository.command';

export { pickGithubRepositoryCommand };

function pickGithubRepositoryCommand(
	github: GithubRepository,
	state: GithubRepositoryState,
	options: RepositoryConnectOptions,
): void {
	if (state.kind === 'available') {
		connectRepositoryCommand({ kind: 'clone-url', url: github.cloneUrl }, options);
		return;
	}
	const { repository } = state;
	if (repository === null) return;
	if (options.open === 'workstream') {
		if (state.kind === 'cloning') return;
		options.onConnected?.();
		createWorkstreamForRepositoryCommand(repository);
		return;
	}
	if (state.kind === 'failed') {
		prepareRepositoryCommand(repository);
		return;
	}
	options.onConnected?.();
	void goto(repositoryHref(repository.id));
}
