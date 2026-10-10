import type { RepositoryImportSource } from './github-auth';
import { projectIdentityCandidatesForRepoUrl } from './project-identity';
import type { Project, Repository } from './repository';
import type { Workstream } from './workstream';

export type ConnectedRepositoryContext = {
	repo: Repository;
	owner: string | null;
	name: string;
	initial: string;
	workstreams: readonly Workstream[];
	activeWorkstream: Workstream | null;
	targetWorkstream: Workstream | null;
	isActive: boolean;
};

export function connectedRepositoryContexts(input: {
	repositories: readonly Repository[];
	workstreams: readonly Workstream[];
	activeWorkstreamId?: string | null;
}): ConnectedRepositoryContext[] {
	const contexts: ConnectedRepositoryContext[] = [];
	const ownerByWorkstreamId = resolveWorkstreamOwners(input);

	for (const repo of input.repositories) {
		const workstreams = input.workstreams.filter(
			(stream) => ownerByWorkstreamId.get(stream.id) === repo.id,
		);
		if (workstreams.length === 0 && isLocalRepositoryId(repo.id)) {
			continue;
		}
		const activeWorkstream =
			workstreams.find((stream) => stream.id === input.activeWorkstreamId) ?? null;

		contexts.push({
			repo,
			owner: repositoryOwner(repo.fullName),
			name: repositoryName(repo.fullName),
			initial: repositoryInitial(repo.fullName),
			workstreams,
			activeWorkstream,
			targetWorkstream: activeWorkstream ?? workstreams[0] ?? null,
			isActive: Boolean(activeWorkstream),
		});
	}

	return contexts;
}

function resolveWorkstreamOwners(input: {
	repositories: readonly Repository[];
	workstreams: readonly Workstream[];
}): Map<string, string> {
	const owners = new Map<string, string>();

	for (const repo of [...input.repositories].sort(connectedBeforeLocal)) {
		const projectIds = new Set(projectIdentityIdsForRepository(repo.fullName));
		if (isLocalRepositoryId(repo.id)) {
			projectIds.add(repo.id.slice('local:'.length));
		}
		for (const stream of input.workstreams) {
			if (owners.has(stream.id) || !projectIds.has(stream.projectId)) continue;
			owners.set(stream.id, repo.id);
		}
	}

	return owners;
}

function connectedBeforeLocal(left: Repository, right: Repository): number {
	return Number(isLocalRepositoryId(left.id)) - Number(isLocalRepositoryId(right.id));
}

function isLocalRepositoryId(id: string): boolean {
	return id.startsWith('local:');
}

export function repositoryContextForWorkstream(input: {
	repositories: readonly Repository[];
	workstreams: readonly Workstream[];
	workstreamId: string;
}): ConnectedRepositoryContext | null {
	return (
		connectedRepositoryContexts({
			repositories: input.repositories,
			workstreams: input.workstreams,
			activeWorkstreamId: input.workstreamId,
		}).find((context) => context.isActive) ?? null
	);
}

export function nextListedWorkstream(input: {
	repositories: readonly Repository[];
	workstreams: readonly Workstream[];
	workstreamId: string;
}): Workstream | null {
	const listed = connectedRepositoryContexts(input).flatMap((context) => context.workstreams);
	const index = listed.findIndex((workstream) => workstream.id === input.workstreamId);
	if (index === -1) return null;
	return listed[index + 1] ?? listed[index - 1] ?? null;
}

export function projectIdentityIdsForRepository(fullName: string): readonly string[] {
	return projectIdentityCandidatesForRepoUrl(`https://github.com/${fullName}.git`).map(
		(identity) => identity.id,
	);
}

export function repositoryName(fullName: string): string {
	return fullName.split('/').at(-1) ?? fullName;
}

export function repositoryOwner(fullName: string): string | null {
	const parts = fullName.split('/');
	return parts.length > 1 ? (parts[0] ?? null) : null;
}

export function repositoryInitial(fullName: string): string {
	return repositoryName(fullName).slice(0, 1).toUpperCase() || 'R';
}

export function localRepositoriesFromProjects(projects: readonly Project[]): Repository[] {
	const byFullName = new Map<string, Repository>();

	for (const project of projects) {
		const fullName = localRepositoryFullName(project);
		if (!fullName) {
			continue;
		}

		byFullName.set(fullName, {
			id: `local:${project.id}`,
			fullName,
			defaultBranch: project.defaultBranch,
			localPath: null,
			remoteUrl: project.remoteUrl ?? null,
			createdAt: '',
		});
	}

	return [...byFullName.values()];
}

export function repositoryProjectIds(
	repository: Repository,
	projects: readonly Project[],
): string[] {
	const ids = new Set(projectIdentityIdsForRepository(repository.fullName));
	if (isLocalRepositoryId(repository.id)) ids.add(repository.id.slice('local:'.length));
	const fullName = repository.fullName.toLowerCase();
	return projects
		.filter(
			(project) =>
				ids.has(project.id) || localRepositoryFullName(project)?.toLowerCase() === fullName,
		)
		.map((project) => project.id);
}

function localRepositoryFullName(project: Project): string | null {
	const fromRemote = project.remoteUrl ? repositoryFullNameFromRemoteUrl(project.remoteUrl) : null;
	if (fromRemote) {
		return fromRemote;
	}

	const segments = project.repoPath
		.replace(/[\\/]+$/u, '')
		.split(/[\\/]/u)
		.filter(Boolean);
	const leaf = segments.at(-1);
	const directory = leaf === 'base' ? (segments.at(-2) ?? leaf) : leaf;

	return directory?.trim() || project.name.trim() || project.id.trim() || null;
}

export function mergeRepositories(
	connected: readonly Repository[],
	local: readonly Repository[],
): Repository[] {
	const byFullName = new Map(connected.map((repo) => [repo.fullName.toLowerCase(), repo]));
	for (const repo of local) {
		const key = repo.fullName.toLowerCase();
		if (!byFullName.has(key)) byFullName.set(key, repo);
	}
	return [...byFullName.values()];
}

export function supportsRemotePullRequests(repo: Repository | null | undefined): boolean {
	if (!repo?.remoteUrl) return false;
	return (
		isGithubRemoteUrl(repo.remoteUrl) && repositoryFullNameFromRemoteUrl(repo.remoteUrl) !== null
	);
}

export function repositoryCloneSource(repo: Pick<Repository, 'remoteUrl' | 'localPath'>): string {
	if (repo.remoteUrl) return repo.remoteUrl;
	if (repo.localPath) return repo.localPath;
	throw new Error('Repository has no remote and no local folder to clone');
}

export function isGithubRemoteUrl(remoteUrl: string): boolean {
	return /(?:^|[/@.])github\.com(?:[/:]|$)/iu.test(remoteUrl.trim());
}

export function repositoryIdentityForImportSource(source: RepositoryImportSource): {
	fullName: string;
	localPath: string | null;
	remoteUrl: string | null;
} {
	if (source.kind === 'clone-url') {
		return {
			fullName: repositoryFullNameFromRemoteUrl(source.url) ?? source.url,
			localPath: null,
			remoteUrl: source.url,
		};
	}
	const folder = source.path
		.replace(/[\\/]+$/u, '')
		.split(/[\\/]/u)
		.filter(Boolean)
		.at(-1);
	return { fullName: folder ?? source.path, localPath: source.path, remoteUrl: null };
}

export function repositoryFullNameFromRemoteUrl(remoteUrl: string): string | null {
	const trimmed = remoteUrl
		.trim()
		.replace(/\/+$/u, '')
		.replace(/\.git$/u, '');
	let path: string;

	if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed)) {
		path = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\//iu, '');
	} else if (/^[^@\s]+@[^:\s]+:/u.test(trimmed)) {
		path = trimmed.replace(/^[^@\s]+@[^:\s]+:/u, '');
	} else {
		return null;
	}

	const parts = path.split('/').filter(Boolean);
	if (parts.length < 2) {
		return null;
	}

	return `${parts.at(-2)}/${parts.at(-1)}`;
}

const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:-?[A-Za-z0-9]){0,38}$/u;

export function githubOwnerFromFullName(fullName: string): string | null {
	const parts = fullName.split('/');
	if (parts.length !== 2) return null;
	const [owner, name] = parts;
	if (!owner || !name || !GITHUB_OWNER_PATTERN.test(owner)) return null;
	return owner;
}
