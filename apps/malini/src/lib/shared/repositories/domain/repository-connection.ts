import {
	GitHubAuthRequiredError,
	isGitHubAuthRequiredError,
	type RepositoryImportSource,
} from './github-auth';
import { projectIdentityCandidatesForRepoUrl } from './project-identity';
import type { Repository } from './repository';
import {
	projectIdentityIdsForRepository,
	repositoryCloneSource,
	repositoryIdentityForImportSource,
} from './repository-context';
import type { Workstream } from './workstream';

export type RepositoryConnectingKind = 'folder' | 'clone';

export type RepositoryConnection = Readonly<{
	kind: RepositoryConnectingKind;
	key: string;
}>;

export function repositoryConnectionFor(source: RepositoryImportSource): RepositoryConnection {
	if (source.kind === 'local-folder') return { kind: 'folder', key: `folder:${source.path}` };
	return { kind: 'clone', key: `clone:${source.url}` };
}

export function isCloneUrl(value: string): boolean {
	const trimmed = value.trim();
	if (!trimmed) return false;
	return /^[a-z][a-z0-9+.-]*:\/\/\S+$/iu.test(trimmed) || /^[^@\s]+@[^:\s]+:\S+$/u.test(trimmed);
}

export type RepositoryConnectFailure = Readonly<{
	detail: string;
	remedy: string | null;
	technical: string | null;
}>;

export function repositoryConnectFailure(
	caught: unknown,
	fallback: string,
	source: RepositoryImportSource | null = null,
): RepositoryConnectFailure {
	const raw =
		caught instanceof Error ? caught.message : typeof caught === 'string' ? caught : fallback;
	const kind = failureKind(caught);
	if (kind === 'auth-required' || caught instanceof GitHubAuthRequiredError) {
		return {
			detail: 'The GitHub CLI is not signed in, or its sign-in has expired.',
			remedy: 'Reconnect it with `gh auth login` in a terminal, then try again.',
			technical: raw,
		};
	}
	if (kind === 'auth-failed' || kind === 'repository-not-found' || isRepositoryNotFound(raw)) {
		const repository = source ? repositoryIdentityForImportSource(source).fullName : null;
		return {
			detail: `GitHub didn't give access to ${repository ?? 'this repository'}.`,
			remedy: 'Check the URL, or sign in with `gh auth login` as an account that can see it.',
			technical: raw,
		};
	}
	if (isGitHubAuthRequiredError(caught)) return { detail: raw, remedy: null, technical: null };
	return {
		detail: raw.replace(/\bworktrees\b/giu, 'workstreams').replace(/\bworktree\b/giu, 'workstream'),
		remedy: null,
		technical: null,
	};
}

export function repositoryConnectFailureLine(failure: RepositoryConnectFailure): string {
	return failure.remedy ? `${failure.detail} ${failure.remedy}` : failure.detail;
}

function failureKind(caught: unknown): string | null {
	if (typeof caught !== 'object' || caught === null) return null;
	const kind: unknown = Reflect.get(caught, 'kind');
	return typeof kind === 'string' ? kind : null;
}

function isRepositoryNotFound(raw: string): boolean {
	return /repository .*not found/iu.test(raw) && /git (clone|error)/iu.test(raw);
}

export function repositoryMatchesImportSource(
	repo: Repository,
	source: RepositoryImportSource,
): boolean {
	if (source.kind === 'local-folder') {
		return repo.localPath !== null && samePath(repo.localPath, source.path);
	}
	return repo.remoteUrl !== null && sameRemote(repo.remoteUrl, source.url);
}

export function workstreamsForRepository(
	repo: Repository,
	workstreams: readonly Workstream[],
): Workstream[] {
	const projectIds = new Set(projectIdentityIdsForRepository(repo.fullName));
	if (repo.id.startsWith('local:')) projectIds.add(repo.id.slice('local:'.length));
	try {
		for (const identity of projectIdentityCandidatesForRepoUrl(repositoryCloneSource(repo))) {
			projectIds.add(identity.id);
		}
	} catch {}
	return workstreams.filter((stream) => projectIds.has(stream.projectId));
}

function samePath(left: string, right: string): boolean {
	const normalize = (path: string): string => path.replace(/[\\/]+$/u, '');
	return normalize(left) === normalize(right);
}

function sameRemote(left: string, right: string): boolean {
	const normalize = (url: string): string =>
		url
			.trim()
			.replace(/\/+$/u, '')
			.replace(/\.git$/u, '')
			.toLowerCase();
	return normalize(left) === normalize(right);
}
