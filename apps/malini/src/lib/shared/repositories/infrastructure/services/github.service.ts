import { invoke } from '$shared/port/invoke';
import {
	GitHubAuthRequiredError,
	isGitHubAuthRequiredError,
	type GitHubAuthStatus,
	type GitHubDeviceCode,
	type GitHubSignInOutcome,
	type RepositoryImportSource,
} from '$shared/repositories/domain/github-auth';
import type {
	GithubRepository,
	ImportedRepository,
	Repository,
} from '$shared/repositories/domain/repository';
import { RepositoryMapper } from '$shared/repositories/infrastructure/mappers/repository.mapper';

class GithubService {
	authStatus(): Promise<GitHubAuthStatus> {
		return withGitHubAuth(() => invoke('repositories.github-auth-status', undefined));
	}

	startSignIn(): Promise<GitHubDeviceCode> {
		return invoke('repositories.start-github-sign-in', undefined);
	}

	finishSignIn(): Promise<GitHubSignInOutcome> {
		return invoke('repositories.finish-github-sign-in', undefined);
	}

	cancelSignIn(): Promise<void> {
		return invoke('repositories.cancel-github-sign-in', undefined);
	}

	pickRepositoryFolder(): Promise<string | null> {
		return withGitHubAuth(() => invoke('repositories.pick-folder', undefined));
	}

	async listRepositories(): Promise<Repository[]> {
		const raws = await withGitHubAuth(() => invoke('repositories.list-clones', undefined));
		return RepositoryMapper.fromRawList(raws);
	}

	listGithubRepositories(): Promise<GithubRepository[]> {
		return withGitHubAuth(() => invoke('repositories.list-github-repositories', undefined));
	}

	async connectRepository(source: RepositoryImportSource): Promise<ImportedRepository> {
		const raw = await withGitHubAuth(() => invoke('repositories.connect', { source }));
		const repo = RepositoryMapper.fromRaw(raw.repository);
		if (!repo) throw new Error('repositories.connect: malformed repository record');
		return { repo, created: raw.created };
	}

	listHiddenRepositoryIds(): Promise<string[]> {
		return invoke('repositories.list-hidden', undefined);
	}

	setRepositoryHidden(repoId: string, hidden: boolean): Promise<void> {
		return invoke('repositories.set-hidden', { repoId, hidden });
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
