import type { WorkstreamId } from './workstream';

const WORKSTREAM_BRANCH_PREFIX = 'malini/';
const PROJECT_ID_PREFIX = 'local__';

export type ProjectIdentity = {
	id: ProjectIdentityId;
	name: string;
};

export type ProjectIdentityId = string;

export function workstreamBranch(workstreamId: WorkstreamId): string {
	return `${WORKSTREAM_BRANCH_PREFIX}${workstreamId}`;
}

export function nextWorkstreamId(): WorkstreamId {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return `01J${crypto.randomUUID().replace(/-/g, '').slice(0, 22)}A`.toUpperCase();
	}
	return `01J${Date.now().toString().padStart(22, '0').toUpperCase()}A`;
}

export function projectIdentityForRepoUrl(repoUrl: string): ProjectIdentity {
	const name = deriveProjectName(repoUrl);
	return { id: `${PROJECT_ID_PREFIX}${name}`, name };
}

export function projectIdentityCandidatesForRepoUrl(repoUrl: string): ProjectIdentity[] {
	const primary = projectIdentityForRepoUrl(repoUrl);
	const legacyName = deriveLegacyProjectName(repoUrl);
	const legacy = { id: `${PROJECT_ID_PREFIX}${legacyName}`, name: legacyName };
	return legacy.id === primary.id ? [primary] : [primary, legacy];
}

function deriveProjectName(repoUrl: string): string {
	const pathish = normalizeRemotePath(repoUrl);
	if (pathish) {
		const parts = pathish.split('/').filter(Boolean);
		if (parts.length >= 2) {
			const owner = parts[parts.length - 2] ?? 'owner';
			const repo = parts[parts.length - 1] ?? 'repo';
			return sanitizeProjectSegment(`${owner}__${repo}`);
		}
	}

	return deriveLegacyProjectName(repoUrl);
}

function deriveLegacyProjectName(repoUrl: string): string {
	const withoutTrailingSlash = repoUrl.trimEnd().replace(/\/+$/u, '');
	const withoutGitSuffix = withoutTrailingSlash.endsWith('.git')
		? withoutTrailingSlash.slice(0, -4)
		: withoutTrailingSlash;
	const rawName = withoutGitSuffix.split('/').filter(Boolean).at(-1) ?? 'repo';
	return sanitizeProjectSegment(rawName);
}

function normalizeRemotePath(repoUrl: string): string | null {
	const withoutTrailingSlash = repoUrl.trimEnd().replace(/\/+$/u, '');
	const withoutGitSuffix = withoutTrailingSlash.endsWith('.git')
		? withoutTrailingSlash.slice(0, -4)
		: withoutTrailingSlash;

	if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(withoutGitSuffix)) {
		return withoutGitSuffix.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\//iu, '');
	}

	if (/^[^@\s]+@[^:\s]+:/u.test(withoutGitSuffix)) {
		return withoutGitSuffix.replace(/^[^@\s]+@[^:\s]+:/u, '');
	}

	return null;
}

function sanitizeProjectSegment(input: string): string {
	return Array.from(input)
		.map((character) => (/^[a-zA-Z0-9_-]$/u.test(character) ? character : '_'))
		.join('');
}
