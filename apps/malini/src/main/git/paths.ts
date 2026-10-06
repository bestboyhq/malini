import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmdirSync,
} from 'node:fs';
import { basename, join, sep } from 'node:path';
import { GitError } from '$main/errors';
import { isInsideDirectory } from '$main/fs/paths';
import { isDirectory } from '$main/fs/stat';
import {
	BRIDGE_AGENT_ATTACHMENTS_PATH,
	BRIDGE_SANDBOX_SCRATCH_PATH,
} from '../../contract/protocol-contract.generated';
import type { WorkstreamCheckoutState } from '../../contract/repositories';

export type { WorkstreamCheckoutState };

export const WORKSTREAM_BRANCH_PREFIX = 'malini/';
export const LEGACY_WORKSTREAM_BRANCH_PREFIXES = ['smack/', 'agentic/'] as const;
export const REPOSITORIES_DIR_NAME = 'repositories';
export const LEGACY_PROJECTS_DIR_NAME = 'projects';
export const WORKSTREAMS_DIR_NAME = 'workstreams';

export const APP_MANAGED_DIR_NAME = '.malini';
export const LEGACY_APP_MANAGED_DIR_NAMES = ['.smack', '.core'] as const;

export const AGENT_ATTACHMENTS_PATH = BRIDGE_AGENT_ATTACHMENTS_PATH;
export const SANDBOX_SCRATCH_PATH = BRIDGE_SANDBOX_SCRATCH_PATH;
const APP_MANAGED_PATHS = [AGENT_ATTACHMENTS_PATH, SANDBOX_SCRATCH_PATH] as const;

export const WORKTREE_CONTENT_PATHSPEC = '.';
export const AGENT_ATTACHMENTS_EXCLUDE_PATHSPEC = `:(exclude,top)${AGENT_ATTACHMENTS_PATH}`;
export const AGENT_ATTACHMENTS_DESCENDANTS_EXCLUDE_PATHSPEC = `:(exclude,top)${AGENT_ATTACHMENTS_PATH}/**`;
export const SANDBOX_SCRATCH_EXCLUDE_PATHSPEC = `:(exclude,top)${SANDBOX_SCRATCH_PATH}`;
export const SANDBOX_SCRATCH_DESCENDANTS_EXCLUDE_PATHSPEC = `:(exclude,top)${SANDBOX_SCRATCH_PATH}/**`;
export const APP_MANAGED_EXCLUDE_PATHSPECS = [
	AGENT_ATTACHMENTS_EXCLUDE_PATHSPEC,
	AGENT_ATTACHMENTS_DESCENDANTS_EXCLUDE_PATHSPEC,
	SANDBOX_SCRATCH_EXCLUDE_PATHSPEC,
	SANDBOX_SCRATCH_DESCENDANTS_EXCLUDE_PATHSPEC,
] as const;
export const REPORTING_PATHSPECS = [
	WORKTREE_CONTENT_PATHSPEC,
	...APP_MANAGED_EXCLUDE_PATHSPECS,
] as const;

export const APP_MANAGED_REPOSITORY_EXCLUDES = [
	`/${AGENT_ATTACHMENTS_PATH}/`,
	`/${SANDBOX_SCRATCH_PATH}/`,
] as const;

export const LEGACY_APP_MANAGED_REPOSITORY_EXCLUDES = LEGACY_APP_MANAGED_DIR_NAMES.flatMap(
	(dir) => [`/${dir}/agent-attachments/`, `/${dir}/sandbox/`],
);

export function isAppManagedGitPath(path: string): boolean {
	const stripped = path.startsWith('./') ? path.slice(2) : path;
	return APP_MANAGED_PATHS.some(
		(managed) => stripped === managed || stripped.startsWith(`${managed}/`),
	);
}

export function validateWorkstreamId(workstreamId: string): void {
	if (workstreamId.length === 0) {
		throw GitError.unsafePath('empty workstream id');
	}
	for (const ch of workstreamId) {
		if (!/^[A-Za-z0-9_-]$/.test(ch)) {
			throw GitError.unsafePath(
				`workstream id contains unsafe char \`${ch}\`: \`${workstreamId}\``,
			);
		}
	}
}

export function workstreamBranchName(workstreamId: string): string {
	validateWorkstreamId(workstreamId);
	return `${WORKSTREAM_BRANCH_PREFIX}${workstreamId}`;
}

export function acceptedWorkstreamBranchNames(workstreamId: string): readonly string[] {
	return [
		workstreamBranchName(workstreamId),
		...LEGACY_WORKSTREAM_BRANCH_PREFIXES.map((prefix) => `${prefix}${workstreamId}`),
	];
}

export function sanitizeSegment(input: string): string {
	return [...input].map((ch) => (/^[A-Za-z0-9_-]$/.test(ch) ? ch : '_')).join('');
}

function trimRepoPath(repoPath: string): string {
	return repoPath.replace(/\/+$/, '').replace(/\.git$/, '');
}

export function remotePath(repoPath: string): string | null {
	const trimmed = trimRepoPath(repoPath);
	const schemeIndex = trimmed.indexOf('://');
	if (schemeIndex !== -1) {
		const rest = trimmed.slice(schemeIndex + 3);
		const pathStart = rest.indexOf('/');
		if (pathStart === -1) return null;
		return rest.slice(pathStart + 1);
	}
	const colonIndex = trimmed.indexOf(':');
	if (colonIndex !== -1) {
		const prefix = trimmed.slice(0, colonIndex);
		if (prefix.includes('@')) return trimmed.slice(colonIndex + 1);
	}
	return null;
}

export function deriveProjectId(repoPath: string): string {
	const pathish = remotePath(repoPath);
	if (pathish !== null) {
		const parts = pathish.split('/').filter((part) => part.length > 0);
		if (parts.length >= 2) {
			const owner = parts[parts.length - 2] ?? '';
			const repo = parts[parts.length - 1] ?? '';
			return sanitizeSegment(`${owner}__${repo}`);
		}
	}
	return deriveLocalProjectId(repoPath);
}

export function deriveLocalProjectId(repoPath: string): string {
	const trimmed = trimRepoPath(repoPath);
	const last = trimmed.split('/').pop() || 'repo';
	return sanitizeSegment(last);
}

export const LOCAL_PROJECT_ID_PREFIX = 'local__';

export function localProjectId(repoId: string): string {
	return `${LOCAL_PROJECT_ID_PREFIX}${repoId}`;
}

export function canonicalGithubHttpsUrl(repositoryFullName: string): string {
	const parts = repositoryFullName.split('/');
	const owner = parts[0] ?? '';
	const repository = parts[1] ?? '';
	const invalid =
		parts.length > 2 ||
		owner.length === 0 ||
		owner.length > 39 ||
		repository.length === 0 ||
		repository.length > 100 ||
		owner.startsWith('-') ||
		owner.endsWith('-') ||
		!/^[A-Za-z0-9-]+$/.test(owner) ||
		!/^[A-Za-z0-9._-]+$/.test(repository) ||
		repository === '.' ||
		repository === '..';
	if (invalid) {
		throw GitError.unsafePath('invalid GitHub repository full name');
	}
	return `https://github.com/${owner}/${repository}.git`;
}

const GITHUB_REMOTE_URL =
	/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?$/u;

export function remoteUrlMatchesCanonicalGithubUrl(
	remoteUrl: string,
	canonicalUrl: string,
): boolean {
	const remote = GITHUB_REMOTE_URL.exec(remoteUrl.trim().toLowerCase())?.[1];
	return remote !== undefined && remote === GITHUB_REMOTE_URL.exec(canonicalUrl.toLowerCase())?.[1];
}

export function validateBaseBranch(baseBranch: string): void {
	const invalid =
		baseBranch.length === 0 ||
		baseBranch.startsWith('-') ||
		baseBranch.startsWith('/') ||
		baseBranch.endsWith('/') ||
		baseBranch.endsWith('.') ||
		baseBranch.endsWith('.lock') ||
		baseBranch.includes('..') ||
		baseBranch.includes('//') ||
		baseBranch.includes('@{') ||
		/[\s~^:?*[\\]/.test(baseBranch);
	if (invalid) {
		throw GitError.unsafePath(`invalid base branch \`${baseBranch}\``);
	}
}

export function repositoriesRoot(appDataRoot: string): string {
	return join(appDataRoot, REPOSITORIES_DIR_NAME);
}

export function legacyProjectsRoot(appDataRoot: string): string {
	return join(appDataRoot, LEGACY_PROJECTS_DIR_NAME);
}

export function repositoryBaseDir(appDataRoot: string, projectId: string): string {
	return join(repositoriesRoot(appDataRoot), projectId, 'base');
}

export function legacyProjectBaseDir(appDataRoot: string, projectId: string): string {
	return join(legacyProjectsRoot(appDataRoot), projectId, 'base');
}

export function workstreamsRoot(appDataRoot: string): string {
	return join(appDataRoot, WORKSTREAMS_DIR_NAME);
}

export function workstreamPath(appDataRoot: string, workstreamId: string): string {
	validateWorkstreamId(workstreamId);
	return join(workstreamsRoot(appDataRoot), workstreamId);
}

export function workstreamCheckoutExists(appDataRoot: string, workstreamId: string): boolean {
	try {
		return isDirectory(workstreamPath(appDataRoot, workstreamId));
	} catch {
		return false;
	}
}

export function pathCanonicalizeDeleteGuard(worktreePath: string, worktreesRoot: string): string {
	for (const segment of worktreePath.split(/[\\/]+/)) {
		if (segment === '..') {
			throw GitError.unsafePath(`path \`${worktreePath}\` contains \`..\` segment`);
		}
		if (segment === '.') {
			throw GitError.unsafePath(`path \`${worktreePath}\` contains \`.\` segment`);
		}
	}
	let canonical: string;
	let canonicalRoot: string;
	try {
		canonical = realpathSync(worktreePath);
	} catch (error) {
		throw GitError.fromNodeError(error);
	}
	try {
		canonicalRoot = realpathSync(worktreesRoot);
	} catch (error) {
		throw GitError.fromNodeError(error);
	}
	if (canonical === canonicalRoot) {
		throw GitError.unsafePath('path equals worktrees root, refusing to delete root');
	}
	if (!isInsideDirectory(canonicalRoot, canonical)) {
		throw GitError.unsafePath(
			`path \`${canonical}\` resolves outside worktrees root \`${canonicalRoot}\``,
		);
	}
	return canonical;
}

export function resolveWorkstreamCheckoutCanonical(
	appDataRoot: string,
	workstreamId: string,
): string {
	return resolveWorkstreamCheckoutCanonicalRecorded(appDataRoot, workstreamId, null);
}

export function resolveWorkstreamCheckoutCanonicalRecorded(
	appDataRoot: string,
	workstreamId: string,
	recordedPath: string | null,
): string {
	validateWorkstreamId(workstreamId);
	const workstreams = workstreamsRoot(appDataRoot);
	const candidates: Array<[root: string, candidate: string]> = [
		[workstreams, workstreamPath(appDataRoot, workstreamId)],
	];
	const recorded = recordedPath?.trim() ?? '';
	if (recorded.length > 0 && recorded !== workstreams && recorded.startsWith(workstreams + sep)) {
		candidates.push([workstreams, recorded]);
	}
	for (const [root, candidate] of candidates) {
		if (existsSync(candidate)) {
			const canonical = pathCanonicalizeDeleteGuard(candidate, root);
			adoptAppManagedDirectory(canonical);
			return canonical;
		}
	}
	throw GitError.checkoutMissing(workstreamId);
}

const APP_MANAGED_SUBDIRECTORIES = ['agent-attachments', 'sandbox'] as const;
const adoptedWorktrees = new Set<string>();

export function adoptAppManagedDirectory(worktreePath: string): void {
	if (adoptedWorktrees.has(worktreePath)) return;
	adoptedWorktrees.add(worktreePath);
	for (const legacyDir of LEGACY_APP_MANAGED_DIR_NAMES) {
		adoptLegacyManagedDirectory(worktreePath, join(worktreePath, legacyDir));
	}
}

function adoptLegacyManagedDirectory(worktreePath: string, legacyRoot: string): void {
	try {
		if (!lstatSync(legacyRoot).isDirectory()) return;
	} catch {
		return;
	}
	const currentRoot = join(worktreePath, APP_MANAGED_DIR_NAME);
	for (const name of APP_MANAGED_SUBDIRECTORIES) {
		const from = join(legacyRoot, name);
		const to = join(currentRoot, name);
		if (!existsSync(from) || existsSync(to)) continue;
		try {
			mkdirSync(currentRoot, { recursive: true });
			renameSync(from, to);
		} catch (error) {
			console.error(
				`malini: could not move \`${from}\` to \`${to}\`: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}
	try {
		if (readdirSync(legacyRoot).length === 0) rmdirSync(legacyRoot);
	} catch {}
}

export function isUsableCheckoutState(state: WorkstreamCheckoutState): boolean {
	return state === 'healthy' || state === 'path-diverged';
}

export interface WorkstreamCheckoutHealth {
	state: WorkstreamCheckoutState;
	recordedPath: string;
	resolvedPath: string | null;
	issue: string | null;
}

export function assessWorkstreamCheckout(
	appDataRoot: string,
	workstreamId: string,
	recordedPath: string,
): WorkstreamCheckoutHealth {
	const recorded = recordedPath.trim();
	const health = (
		state: WorkstreamCheckoutState,
		resolvedPath: string | null,
		issue: string | null,
	): WorkstreamCheckoutHealth => ({ state, recordedPath: recorded, resolvedPath, issue });

	let canonical: string;
	try {
		canonical = resolveWorkstreamCheckoutCanonicalRecorded(appDataRoot, workstreamId, recorded);
	} catch (error) {
		if (error instanceof GitError && error.kind === 'io' && error.code === 'ENOENT') {
			let expected = recorded;
			try {
				expected = workstreamPath(appDataRoot, workstreamId);
			} catch {}
			return health(
				'missing',
				null,
				`no checkout directory at \`${expected}\` - it was removed outside the app`,
			);
		}
		return health('unresolvable', null, error instanceof Error ? error.message : String(error));
	}

	if (!existsSync(join(canonical, '.git'))) {
		return health(
			'not-a-checkout',
			canonical,
			`\`${canonical}\` has no .git entry, so it is not a git checkout any more`,
		);
	}
	if (recorded.length === 0) {
		return health(
			'path-diverged',
			canonical,
			`no checkout path is recorded for this workstream; the checkout in use is \`${canonical}\``,
		);
	}
	let canonicalRecorded: string;
	try {
		canonicalRecorded = realpathSync(recorded);
	} catch {
		return health(
			'path-diverged',
			canonical,
			`the recorded checkout path \`${recorded}\` does not exist; the checkout in use is \`${canonical}\``,
		);
	}
	if (canonicalRecorded === canonical) {
		return health('healthy', canonical, null);
	}
	return health(
		'path-diverged',
		canonical,
		`the recorded checkout path \`${canonicalRecorded}\` is not the checkout in use \`${canonical}\``,
	);
}

export function deriveBranchFromPath(worktreePath: string): string {
	const name = basename(worktreePath);
	return name.length > 0 ? `${WORKSTREAM_BRANCH_PREFIX}${name}` : '';
}
