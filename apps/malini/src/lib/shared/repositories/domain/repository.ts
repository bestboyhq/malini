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
