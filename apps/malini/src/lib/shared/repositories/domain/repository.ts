import type { RepositoryConnectFailure } from './repository-connection';

export type ProjectId = string;

export type Project = {
	id: ProjectId;
	name: string;
	repoPath: string;
	defaultBranch: string;
	remoteUrl?: string | null;
};

export type RepositoryId = string;

export type Repository = {
	id: RepositoryId;
	fullName: string;
	defaultBranch: string;
	localPath: string | null;
	remoteUrl: string | null;
	createdAt: string;
};

export type GithubRepository = Readonly<{
	fullName: string;
	description: string | null;
	cloneUrl: string;
}>;

export type GithubRepositoryListing =
	| Readonly<{ kind: 'loading' }>
	| Readonly<{ kind: 'loaded'; repositories: readonly GithubRepository[] }>
	| Readonly<{ kind: 'failed'; failure: RepositoryConnectFailure }>;
