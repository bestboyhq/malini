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

export type ImportedRepository = Readonly<{ repo: Repository; created: boolean }>;

export type GithubRepository = Readonly<{
	fullName: string;
	description: string | null;
	cloneUrl: string;
	private: boolean;
	pushedAt: string | null;
}>;

export type NewGithubRepository = Readonly<{ owner: string; name: string; private: boolean }>;

export function githubRepositoryName(typed: string): string {
	return typed.trim().replace(/[^A-Za-z0-9._-]+/gu, '-');
}

export type GithubRepositoryListing =
	| Readonly<{ kind: 'loading' }>
	| Readonly<{ kind: 'loaded'; repositories: readonly GithubRepository[] }>
	| Readonly<{ kind: 'failed'; failure: RepositoryConnectFailure }>;
