import {
	GH_CREDENTIAL_HELPER_CONFIG,
	normalizeGithubToken,
	type GitCredentialEnv,
} from './credentials';
import { ensureStagingPrecondition } from './excludes';
import {
	acceptedWorkstreamBranchNames,
	canonicalGithubHttpsUrl,
	remoteUrlMatchesCanonicalGithubUrl,
	REPORTING_PATHSPECS,
	validateBaseBranch,
	WORKTREE_CONTENT_PATHSPEC,
} from './paths';
import { attributeCredentials, failureOutput, GitError } from '$main/errors';
import {
	ALLOW_GITHUB_HTTPS_PROTOCOL_CONFIG,
	DENY_UNDECLARED_GIT_PROTOCOLS_CONFIG,
	DISABLED_GIT_HOOKS_CONFIG,
	REQUIRE_TLS_VERIFICATION_CONFIG,
	runGit,
} from './run';
import { AGENT_IDENTITY } from './snapshots';
import { conflictMarkerPaths, inProgressOperation, statusCollector } from './status';

const AGENT_COMMIT_CONFIG = [
	'-c',
	'commit.gpgsign=false',
	'-c',
	`user.email=${AGENT_IDENTITY.email}`,
	'-c',
	`user.name=${AGENT_IDENTITY.name}`,
] as const;

export const MAX_ADDED_FILES_PER_COMMIT = 2_000;

export async function commitWorktreeChanges(worktree: string, message: string): Promise<string> {
	await ensureStagingPrecondition(worktree);
	const operation = await inProgressOperation(worktree);
	if (operation !== null && operation !== 'merge') {
		throw new GitError(
			'git',
			`A ${operation} is in progress in this workstream. Finish or abort it before committing.`,
		);
	}
	await refuseConflictMarkers(worktree);
	const merging = operation === 'merge';
	await runGit(['-C', worktree, 'add', '-A', '--', WORKTREE_CONTENT_PATHSPEC]);
	const added = await addedFileCount(worktree, merging);
	if (added > MAX_ADDED_FILES_PER_COMMIT) {
		throw GitError.git(
			`this commit would add ${added} files, which looks like generated or downloaded output (a package store, node_modules, a build); add it to .gitignore, or commit it yourself if you mean it`,
		);
	}
	await runGit([
		'-C',
		worktree,
		...AGENT_COMMIT_CONFIG,
		'commit',
		...(merging ? ['--no-edit', '--cleanup=strip'] : ['-m', message, '--', ...REPORTING_PATHSPECS]),
	]);
	return (await runGit(['-C', worktree, 'rev-parse', '--short', 'HEAD'])).trim();
}

async function refuseConflictMarkers(worktree: string): Promise<void> {
	const marked = await conflictMarkerPaths(worktree, await unmergedPaths(worktree));
	if (marked.length === 0) return;
	throw new GitError(
		'git',
		`Conflict markers remain in ${marked.join(', ')}. Resolve them, then commit again.`,
	);
}

async function unmergedPaths(worktree: string): Promise<string[]> {
	return (await runGit(['-C', worktree, 'diff', '--name-only', '--diff-filter=U', '-z']))
		.split('\0')
		.filter(Boolean);
}

async function addedFileCount(worktree: string, merging: boolean): Promise<number> {
	const addedAgainst = async (commit: readonly string[]): Promise<string[]> =>
		(
			await runGit([
				'-C',
				worktree,
				'diff',
				'--cached',
				'--name-only',
				'--diff-filter=A',
				'-z',
				...commit,
			])
		)
			.split('\0')
			.filter(Boolean);
	const added = await addedAgainst([]);
	if (!merging) return added.length;
	const newToBase = new Set(await addedAgainst(['MERGE_HEAD']));
	return added.filter((path) => newToBase.has(path)).length;
}

async function currentBranch(worktreePath: string): Promise<string> {
	return (await runGit(['-C', worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD'])).trim();
}

function requireWorkstreamBranch(workstreamId: string, branch: string): string {
	const accepted = acceptedWorkstreamBranchNames(workstreamId);
	if (!accepted.includes(branch)) {
		throw GitError.git(
			`workstream branch mismatch: expected \`${accepted[0] ?? ''}\`, got \`${branch}\``,
		);
	}
	return branch;
}

export async function commitWorkstreamBranch(
	worktreePath: string,
	workstreamId: string,
	message: string,
): Promise<string> {
	requireWorkstreamBranch(workstreamId, await currentBranch(worktreePath));
	return commitWorktreeChanges(worktreePath, message);
}

export async function verifyOriginMatchesExpectedGithubRepository(
	worktreePath: string,
	canonicalUrl: string,
): Promise<void> {
	for (const args of [
		['-C', worktreePath, 'remote', 'get-url', '--all', 'origin'],
		['-C', worktreePath, 'remote', 'get-url', '--push', '--all', 'origin'],
	]) {
		const urls = (await runGit(args)).split('\n').filter((url) => url.trim().length > 0);
		if (urls.length === 0) {
			throw GitError.git('workstream origin has no configured GitHub URL');
		}
		if (urls.some((url) => !remoteUrlMatchesCanonicalGithubUrl(url, canonicalUrl))) {
			throw GitError.git('workstream origin no longer matches the selected GitHub repository');
		}
	}
}

const REMOTE_HAS_NEW_COMMITS = /\[rejected\][^\n]*\((?:fetch first|non-fast-forward)\)/u;

export async function pushWorkstreamBranch(
	worktreePath: string,
	workstreamId: string,
	expectedRepositoryFullName: string,
	githubToken: string | null | undefined,
	credentials: GitCredentialEnv,
): Promise<string> {
	const canonicalUrl = canonicalGithubHttpsUrl(expectedRepositoryFullName);
	const branch = requireWorkstreamBranch(workstreamId, await currentBranch(worktreePath));
	await verifyOriginMatchesExpectedGithubRepository(worktreePath, canonicalUrl);

	const env = await credentials.prepare(normalizeGithubToken(githubToken));
	const push = (): Promise<string> =>
		runGit(githubPushArgs(worktreePath, canonicalUrl, `${branch}:refs/heads/${branch}`), env);
	try {
		await push();
	} catch (error) {
		if (!REMOTE_HAS_NEW_COMMITS.test(failureOutput(error))) throw error;
		const remoteRef = await syncRemoteBase(worktreePath, branch, githubToken, credentials);
		try {
			await mergeRemoteRef(worktreePath, remoteRef, branch, 'abort');
		} catch {
			throw GitError.git(
				`GitHub has commits on ${branch} that do not merge cleanly with this workstream. Merge origin/${branch} into it, then push again.`,
			);
		}
		await push();
	}

	await runGit([
		'-C',
		worktreePath,
		'-c',
		DISABLED_GIT_HOOKS_CONFIG,
		'update-ref',
		`refs/remotes/origin/${branch}`,
		'HEAD',
	]);
	await runGit([
		'-C',
		worktreePath,
		'config',
		'--local',
		'--replace-all',
		`branch.${branch}.remote`,
		'origin',
	]);
	await runGit([
		'-C',
		worktreePath,
		'config',
		'--local',
		'--replace-all',
		`branch.${branch}.merge`,
		`refs/heads/${branch}`,
	]);
	return branch;
}

function githubPushArgs(
	worktreePath: string,
	canonicalUrl: string,
	refspec: string,
	options: readonly string[] = [],
): string[] {
	return [
		'-C',
		worktreePath,
		...GH_CREDENTIAL_HELPER_CONFIG,
		'-c',
		DISABLED_GIT_HOOKS_CONFIG,
		'-c',
		DENY_UNDECLARED_GIT_PROTOCOLS_CONFIG,
		'-c',
		ALLOW_GITHUB_HTTPS_PROTOCOL_CONFIG,
		'-c',
		REQUIRE_TLS_VERIFICATION_CONFIG,
		'push',
		'--no-verify',
		...options,
		canonicalUrl,
		refspec,
	];
}

const MERGED_BRANCH_ALREADY_GONE = /remote ref does not exist|stale info/u;

const FULL_COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export async function restartWorkstreamOnBase(
	worktreePath: string,
	workstreamId: string,
	baseBranch: string,
	mergedHeadSha: string,
	expectedRepositoryFullName: string,
	githubToken: string | null | undefined,
	credentials: GitCredentialEnv,
): Promise<string> {
	validateBaseBranch(baseBranch);
	if (!FULL_COMMIT_ID.test(mergedHeadSha)) {
		throw GitError.git('the merged pull request head must be a full commit id');
	}
	const status = await statusCollector(worktreePath);
	const branch = requireWorkstreamBranch(workstreamId, status.branch);
	if (status.operationInProgress !== null) {
		throw GitError.git(
			`a ${status.operationInProgress} is already in progress in this workstream; finish or abort it before continuing`,
		);
	}
	const canonicalUrl = canonicalGithubHttpsUrl(expectedRepositoryFullName);
	await verifyOriginMatchesExpectedGithubRepository(worktreePath, canonicalUrl);
	const baseRef = await syncRemoteBase(worktreePath, baseBranch, githubToken, credentials);
	if (!(await hasCommit(worktreePath, mergedHeadSha))) {
		await syncRemoteBase(worktreePath, branch, githubToken, credentials);
	}
	const forkPoint = (
		await runGit(['-C', worktreePath, 'merge-base', 'HEAD', mergedHeadSha])
	).trim();

	const env = await credentials.prepare(normalizeGithubToken(githubToken));
	try {
		await runGit(
			githubPushArgs(worktreePath, canonicalUrl, `:refs/heads/${branch}`, [
				`--force-with-lease=refs/heads/${branch}:${mergedHeadSha}`,
			]),
			env,
		);
	} catch (error) {
		if (!MERGED_BRANCH_ALREADY_GONE.test(failureOutput(error))) throw error;
	}
	await runGit(['-C', worktreePath, 'update-ref', '-d', `refs/remotes/origin/${branch}`]);
	await runGit(['-C', worktreePath, 'branch', '--unset-upstream']).catch(() => undefined);

	try {
		await runGit([
			'-C',
			worktreePath,
			...AGENT_COMMIT_CONFIG,
			'-c',
			DISABLED_GIT_HOOKS_CONFIG,
			'rebase',
			'--autostash',
			'--onto',
			baseRef,
			forkPoint,
		]);
	} catch (error) {
		if ((await inProgressOperation(worktreePath)) !== 'rebase') throw error;
	}
	return (await runGit(['-C', worktreePath, 'rev-parse', '--short', 'HEAD'])).trim();
}

async function hasCommit(worktreePath: string, sha: string): Promise<boolean> {
	try {
		await runGit(['-C', worktreePath, 'cat-file', '-e', `${sha}^{commit}`]);
		return true;
	} catch {
		return false;
	}
}

export async function pullWorkstreamBaseBranch(
	worktreePath: string,
	workstreamId: string,
	baseBranch: string,
	githubToken: string | null | undefined,
	credentials: GitCredentialEnv,
): Promise<string> {
	validateBaseBranch(baseBranch);
	const status = await statusCollector(worktreePath);
	const branch = requireWorkstreamBranch(workstreamId, status.branch);
	if (status.operationInProgress !== null) {
		throw GitError.git(
			`a ${status.operationInProgress} is already in progress in this workstream; finish or abort it before pulling the target branch`,
		);
	}
	if (status.dirtyPaths.length > 0) {
		throw GitError.git('commit or discard local changes before pulling the target branch');
	}
	const remoteRef = await syncRemoteBase(worktreePath, baseBranch, githubToken, credentials);
	await mergeRemoteRef(worktreePath, remoteRef, branch, 'hold');
	return (await runGit(['-C', worktreePath, 'rev-parse', '--short', 'HEAD'])).trim();
}

export async function abortWorkstreamOperation(
	worktreePath: string,
	workstreamId: string,
): Promise<void> {
	const status = await statusCollector(worktreePath);
	requireWorkstreamBranch(workstreamId, status.branch);
	if (status.operationInProgress === null) {
		throw GitError.git('no merge, rebase, cherry-pick or revert is in progress in this workstream');
	}
	await runGit([
		'-C',
		worktreePath,
		'-c',
		DISABLED_GIT_HOOKS_CONFIG,
		status.operationInProgress,
		'--abort',
	]);
}

async function mergeRemoteRef(
	worktreePath: string,
	ref: string,
	into: string,
	conflicts: 'abort' | 'hold',
): Promise<void> {
	const message = `Merge remote-tracking branch '${ref.replace(/^refs\/remotes\//u, '')}' into ${into}`;
	try {
		await runGit([
			'-C',
			worktreePath,
			...AGENT_COMMIT_CONFIG,
			'merge',
			'--no-edit',
			'-m',
			message,
			ref,
		]);
	} catch (error) {
		if (conflicts === 'hold' && (await unmergedPaths(worktreePath)).length > 0) return;
		try {
			await runGit(['-C', worktreePath, 'merge', '--abort']);
		} catch {}
		throw error;
	}
}

export async function syncRemoteBase(
	basePath: string,
	baseBranch: string,
	githubToken: string | null | undefined,
	credentials: GitCredentialEnv,
): Promise<string> {
	validateBaseBranch(baseBranch);
	const token = normalizeGithubToken(githubToken);
	const env = await credentials.prepare(token);
	const remoteRef = `refs/remotes/origin/${baseBranch}`;
	const refspec = `+refs/heads/${baseBranch}:${remoteRef}`;
	try {
		await runGit(
			[
				'-C',
				basePath,
				...GH_CREDENTIAL_HELPER_CONFIG,
				'-c',
				DISABLED_GIT_HOOKS_CONFIG,
				'fetch',
				'--prune',
				'origin',
				refspec,
			],
			env,
		);
	} catch (error) {
		throw error instanceof GitError ? attributeCredentials(error, token) : error;
	}
	await runGit(['-C', basePath, 'rev-parse', '--verify', remoteRef]);
	return remoteRef;
}

export async function recordedRemoteBase(
	basePath: string,
	baseBranch: string,
): Promise<string | null> {
	validateBaseBranch(baseBranch);
	const remoteRef = `refs/remotes/origin/${baseBranch}`;
	try {
		await runGit(['-C', basePath, 'rev-parse', '--verify', '--quiet', `${remoteRef}^{commit}`]);
	} catch {
		return null;
	}
	return remoteRef;
}

export type CheckoutFastForward = 'current' | 'advanced' | 'diverged';

export async function fastForwardCheckout(
	worktreePath: string,
	targetRef: string,
): Promise<CheckoutFastForward> {
	const head = (await runGit(['-C', worktreePath, 'rev-parse', '--verify', 'HEAD'])).trim();
	const target = (
		await runGit(['-C', worktreePath, 'rev-parse', '--verify', `${targetRef}^{commit}`])
	).trim();
	if (head === target) return 'current';
	const mergeBase = (await runGit(['-C', worktreePath, 'merge-base', head, target])).trim();
	if (mergeBase !== head) return 'diverged';
	await runGit([
		'-C',
		worktreePath,
		'-c',
		DISABLED_GIT_HOOKS_CONFIG,
		'merge',
		'--ff-only',
		'--quiet',
		target,
	]);
	return 'advanced';
}
