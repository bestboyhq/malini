import type { GithubRepository } from '$shared/repositories/domain/repository';
import type {
	GithubRepositoryState,
	RepositoryConnectOptions,
} from '$shared/repositories/domain/repository-connection';
import { connectRepositoryCommand } from './connect-repository.command';
import { createWorkstreamForRepositoryCommand } from './create-workstream-for-repository.command';

export { pickGithubRepositoryCommand };

function pickGithubRepositoryCommand(
	github: GithubRepository,
	state: GithubRepositoryState,
	options: RepositoryConnectOptions = {},
): void {
	if (state.kind === 'available') {
		connectRepositoryCommand({ kind: 'clone-url', url: github.cloneUrl }, options);
		return;
	}
	if (state.kind === 'cloning') return;
	options.onConnected?.();
	createWorkstreamForRepositoryCommand(state.repository);
}
