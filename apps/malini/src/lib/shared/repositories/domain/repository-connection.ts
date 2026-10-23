import {
	GitHubAuthRequiredError,
	isGitHubAuthRequiredError,
	type RepositoryImportSource,
} from './github-auth';
import { projectIdentityCandidatesForRepoUrl } from './project-identity';
import type { Repository } from './repository';
import { projectIdentityIdsForRepository, repositoryCloneSource } from './repository-context';
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

export type RepositoryPreparation =
	| Readonly<{ kind: 'ready' }>
	| Readonly<{ kind: 'preparing' }>
	| Readonly<{ kind: 'failed'; failure: RepositoryConnectFailure }>;

export function repositoryConnectFailure(
	caught: unknown,
	fallback: string,
	repository: string | null = null,
): RepositoryConnectFailure {
	const raw =
		caught instanceof Error ? caught.message : typeof caught === 'string' ? caught : fallback;
	const kind = failureKind(caught);
	if (kind === 'auth-required' || caught instanceof GitHubAuthRequiredError) {
		return {
			detail: 'GitHub is not signed in, or its sign-in has expired.',
			remedy: 'Sign in to GitHub, then try again.',
			technical: raw,
		};
	}
	if (kind === 'auth-failed' || kind === 'repository-not-found' || isRepositoryNotFound(raw)) {
		return {
			detail: `GitHub didn't give access to ${repository ?? 'this repository'}.`,
			remedy: 'Check the URL, or sign in to GitHub as an account that can see it.',
			technical: raw,
		};
	}
	if (isGitHubAuthRequiredError(caught)) return { detail: raw, remedy: null, technical: null };
	const detail = raw
		.replace(/\bworktrees\b/giu, 'workstreams')
		.replace(/\bworktree\b/giu, 'workstream');
	return {
		detail: `${detail.charAt(0).toUpperCase()}${detail.slice(1)}`,
		remedy: null,
		technical: null,
	};
}

function failureKind(caught: unknown): string | null {
	if (typeof caught !== 'object' || caught === null) return null;
	const kind: unknown = Reflect.get(caught, 'kind');
	return typeof kind === 'string' ? kind : null;
}

function isRepositoryNotFound(raw: string): boolean {
	return /repository .*not found/iu.test(raw) && /git (clone|error)/iu.test(raw);
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
