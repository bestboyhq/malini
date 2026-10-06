import { invoke } from '$shared/port/invoke';
import {
	GitHubAuthRequiredError,
	isGitHubAuthRequiredError,
	type GitHubAuthStatus,
	type RepositoryImportSource,
} from '$shared/repositories/domain/github-auth';
import type { Repository } from '$shared/repositories/domain/repository';
import { RepositoryMapper } from '$shared/repositories/infrastructure/mappers/repository.mapper';

class GithubService {
	authStatus(): Promise<GitHubAuthStatus> {
		return withGitHubAuth(() => invoke('repositories.github-auth-status', undefined));
	}

	pickRepositoryFolder(): Promise<string | null> {
		return withGitHubAuth(() => invoke('repositories.pick-folder', undefined));
	}

	async listRepositories(): Promise<Repository[]> {
		const raws = await withGitHubAuth(() => invoke('repositories.list-clones', undefined));
		return RepositoryMapper.fromRawList(raws);
	}

	async connectRepository(source: RepositoryImportSource): Promise<Repository> {
		const raw = await withGitHubAuth(() => invoke('repositories.connect', { source }));
		const repository = RepositoryMapper.fromRaw(raw);
		if (!repository) throw new Error('repositories.connect: malformed repository record');
		return repository;
	}

	disconnectRepository(repoId: string): Promise<void> {
		return withGitHubAuth(() => invoke('repositories.disconnect', { repoId }));
	}

	removeRepository(repoId: string): Promise<void> {
		return invoke('repositories.remove', { repoId });
	}
}

export const githubService = new GithubService();

async function withGitHubAuth<T>(request: () => Promise<T>): Promise<T> {
	try {
		return await request();
	} catch (error) {
		if (isGitHubAuthRequiredError(error)) {
			throw new GitHubAuthRequiredError(error instanceof Error ? error.message : String(error));
		}
		throw error;
	}
}
