import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import {
	GH_CREDENTIAL_HELPER_CONFIG,
	noPromptCredentialEnv,
	normalizeGithubToken,
	type GitCredentialEnv,
} from './credentials';
import { ensureStagingPrecondition } from './excludes';
import {
	canonicalGithubHttpsUrl,
	isValidBranchName,
	remoteUrlMatchesCanonicalGithubUrl,
	REPORTING_PATHSPECS,
	validateBaseBranch,
	WORKTREE_CONTENT_PATHSPEC,
} from './paths';
import { attributeCredentials, failureOutput, GitError } from '$main/errors';
import { runGh } from '$main/process/gh';
import {
	ALLOW_GITHUB_HTTPS_PROTOCOL_CONFIG,
	DENY_UNDECLARED_GIT_PROTOCOLS_CONFIG,
	DISABLED_GIT_HOOKS_CONFIG,
	MAX_GIT_STDOUT_BYTES,
	REQUIRE_TLS_VERIFICATION_CONFIG,
	runGit,
	runGitAllowingExit,
	runGitBoundedStdout,
	runGitWithInput,
} from './run';
import { AGENT_IDENTITY, SNAPSHOT_REF_ROOT } from './snapshots';
import { conflictMarkerPaths, inProgressOperation, statusCollector } from './status';

type CommitIdentity = Readonly<{ name: string; email: string }>;

const GITHUB_ACCOUNT_FRESH_MS = 10 * 60_000;
const GITHUB_ACCOUNT_TIMEOUT_MS = 15_000;
let knownAccount: Readonly<{ identity: CommitIdentity; readAt: number }> | null = null;

async function commitConfig(fallback: CommitIdentity | null = null): Promise<string[]> {
	const identity = (await githubCommitIdentity()) ?? fallback;
	return [
		'-c',
		'commit.gpgsign=false',
		...(identity ? ['-c', `user.name=${identity.name}`, '-c', `user.email=${identity.email}`] : []),
	];
}

export async function githubCommitIdentity(): Promise<CommitIdentity | null> {
	if (knownAccount && Date.now() - knownAccount.readAt < GITHUB_ACCOUNT_FRESH_MS) {
		return knownAccount.identity;
	}
	const identity = await githubAccount();
	if (identity) knownAccount = { identity, readAt: Date.now() };
	return knownAccount?.identity ?? null;
}

async function githubAccount(): Promise<CommitIdentity | null> {
	const result = await runGh(['api', 'user', '--jq', '[.id, .login, .name // ""] | @tsv'], {
		timeoutMs: GITHUB_ACCOUNT_TIMEOUT_MS,
	}).catch(() => null);
	const [id = '', login = '', name = ''] =
		result?.code === 0 ? result.stdout.trim().split('\t') : [];
	if (!/^\d+$/u.test(id) || !/^[A-Za-z0-9-]{1,39}$/u.test(login)) return null;
	return {
		name: name.replace(/[<>]/gu, '').trim() || login,
		email: `${id}+${login}@users.noreply.github.com`,
	};
}

const NOREPLY_ADDRESS = /@users\.noreply\.github\.com$/iu;
const SIGNATURE_HEADER = /^gpgsig(?:-sha256)? /u;
const PERSON_HEADER = /^(author|committer) [^<]*<([^>]*)>(.*)$/u;

// ponytail: two git calls per rewritten commit; use `cat-file --batch` and `fast-import` if a push ever rewrites thousands
async function replaceYourEmailBeforePush(worktree: string): Promise<void> {
	const yours = await yourEmails(worktree);
	const unpushed = (
		await runGit([
			'-C',
			worktree,
			'rev-list',
			'--reverse',
			'--topo-order',
			'--no-commit-header',
			'--format=%H%x00%ae%x00%ce',
			'HEAD',
			'--not',
			'--remotes',
		])
	)
		.split('\n')
		.filter(Boolean)
		.map((line) => line.split('\0'));
	const first = unpushed.findIndex(([, author = '', committer = '']) =>
		[author, committer].some((email) => yours.has(email.toLowerCase())),
	);
	if (first === -1) return;
	const identity = await githubCommitIdentity();
	if (!identity) {
		throw GitError.git(
			'Malini could not read your GitHub account, so it did not push commits that carry your email address. Push again once GitHub answers.',
		);
	}
	const rewritten = new Map<string, string>();
	for (const [sha = ''] of unpushed.slice(first)) {
		const raw = await runGitBoundedStdout(
			['-C', worktree, 'cat-file', 'commit', sha],
			MAX_GIT_STDOUT_BYTES,
			'a commit that carries your email address',
		);
		const commit = withNoreplyAddress(raw, identity, yours, rewritten);
		if (commit === raw) continue;
		const written = await runGitWithInput(
			['-C', worktree, 'hash-object', '-t', 'commit', '-w', '--stdin'],
			commit,
		);
		rewritten.set(sha, written.trim());
	}
	const [head = ''] = unpushed.at(-1) ?? [];
	const replaced = rewritten.get(head);
	if (!replaced) return;
	await runGit([
		'-C',
		worktree,
		'update-ref',
		'-m',
		'malini: noreply address',
		'HEAD',
		replaced,
		head,
	]);
}

async function yourEmails(worktree: string): Promise<Set<string>> {
	const configured = await runGit([
		'-C',
		worktree,
		'config',
		'--get-regexp',
		'^(user|author|committer)\\.email$',
	]).catch(() => '');
	return new Set(
		[
			...configured.split('\n').map((line) => line.slice(line.indexOf(' ') + 1)),
			`${userInfo().username}@${hostname()}`,
		]
			.map((email) => email.trim().toLowerCase())
			.filter((email) => email.includes('@') && !NOREPLY_ADDRESS.test(email)),
	);
}

function withNoreplyAddress(
	raw: string,
	identity: CommitIdentity,
	yours: ReadonlySet<string>,
	rewritten: ReadonlyMap<string, string>,
): string {
	const split = raw.indexOf('\n\n');
	const headers = (split === -1 ? raw : raw.slice(0, split)).split('\n');
	const replaced = headers.map((line) => {
		const parent = /^parent ([0-9a-f]+)$/u.exec(line)?.[1];
		if (parent) return `parent ${rewritten.get(parent) ?? parent}`;
		const [, role, email = '', rest = ''] = PERSON_HEADER.exec(line) ?? [];
		return role && yours.has(email.toLowerCase())
			? `${role} ${identity.name} <${identity.email}>${rest}`
			: line;
	});
	if (replaced.every((line, index) => line === headers[index])) return raw;
	let signature = false;
	const unsigned = replaced.filter((line) => {
		if (!line.startsWith(' ')) signature = SIGNATURE_HEADER.test(line);
		return !signature;
	});
	return `${unsigned.join('\n')}${split === -1 ? '' : raw.slice(split)}`;
}

export const MAX_ADDED_FILES_PER_COMMIT = 2_000;

export const MALINI_CO_AUTHOR = `Co-authored-by: ${AGENT_IDENTITY.name} <${AGENT_IDENTITY.email}>`;

export async function commitWorktreeChanges(
	worktree: string,
	message: string,
	signed = false,
): Promise<string> {
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
		...(await commitConfig()),
		'commit',
		...(merging
			? ['--no-edit', '--cleanup=strip']
			: ['-m', message, ...(signed ? ['-m', MALINI_CO_AUTHOR] : []), '--', ...REPORTING_PATHSPECS]),
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

function requireWorkstreamBranch(expected: string, branch: string): string {
	if (branch !== expected) {
		throw GitError.git(`workstream branch mismatch: expected \`${expected}\`, got \`${branch}\``);
	}
	return branch;
}

export async function commitWorkstreamBranch(
	worktreePath: string,
	expectedBranch: string,
	message: string,
	signed = false,
): Promise<string> {
	requireWorkstreamBranch(expectedBranch, await currentBranch(worktreePath));
	return commitWorktreeChanges(worktreePath, message, signed);
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
	expectedBranch: string,
	expectedRepositoryFullName: string,
	githubToken: string | null | undefined,
	credentials: GitCredentialEnv,
): Promise<string> {
	const canonicalUrl = canonicalGithubHttpsUrl(expectedRepositoryFullName);
	const branch = requireWorkstreamBranch(expectedBranch, await currentBranch(worktreePath));
	await verifyOriginMatchesExpectedGithubRepository(worktreePath, canonicalUrl);

	const env = await credentials.prepare(normalizeGithubToken(githubToken));
	const push = async (): Promise<string> => {
		await replaceYourEmailBeforePush(worktreePath);
		return runGit(
			githubPushArgs(worktreePath, canonicalUrl, `${branch}:refs/heads/${branch}`),
			env,
		);
	};
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

export async function commitPaths(
	worktree: string,
	message: string,
	paths: readonly string[],
): Promise<boolean> {
	await runGit(['-C', worktree, 'add', '-A', '--', ...paths]);
	const staged = await runGit(['-C', worktree, 'diff', '--cached', '--name-only', '--', ...paths]);
	if (staged.trim().length === 0) return false;
	await runGit([
		'-C',
		worktree,
		...(await commitConfig(AGENT_IDENTITY)),
		'-c',
		DISABLED_GIT_HOOKS_CONFIG,
		'commit',
		'-q',
		'-m',
		message,
		'--',
		...paths,
	]);
	return true;
}

const FIRST_COMMIT_PATHSPECS = [
	WORKTREE_CONTENT_PATHSPEC,
	':(exclude,glob)**/node_modules/**',
	':(exclude,glob)**/.venv/**',
	':(exclude,glob)**/.env',
	':(exclude,glob)**/.env.*',
	':(exclude,glob)**/.DS_Store',
] as const;

export async function startHistory(folder: string): Promise<void> {
	if (!existsSync(join(folder, '.git'))) await runGit(['-C', folder, 'init', '-q']);
	const unborn = await runGitAllowingExit(['-C', folder, 'rev-parse', '--verify', '-q', 'HEAD'], 1);
	if (!unborn.allowed) return;
	await runGit(['-C', folder, 'add', '-A', '--', ...FIRST_COMMIT_PATHSPECS]);
	await runGit([
		'-C',
		folder,
		...(await commitConfig(AGENT_IDENTITY)),
		'-c',
		DISABLED_GIT_HOOKS_CONFIG,
		'commit',
		'-q',
		'--allow-empty',
		'-m',
		'Initial commit',
	]);
}

export const MAIN_DIVERGED =
	'GitHub has brain changes this Mac lacks, and they clash with its own. Pull them into the Brain workstream, then retry.';

const MAIN_PUSH_ROUNDS = 3;

export async function pushHeadToGithubMain(
	worktreePath: string,
	repositoryFullName: string,
	credentials: GitCredentialEnv = noPromptCredentialEnv,
): Promise<void> {
	const canonicalUrl = canonicalGithubHttpsUrl(repositoryFullName);
	const env = await credentials.prepare(null);
	for (let round = 1; ; round += 1) {
		try {
			await replaceYourEmailBeforePush(worktreePath);
			await runGit(githubPushArgs(worktreePath, canonicalUrl, 'HEAD:refs/heads/main'), env);
			break;
		} catch (error) {
			if (round === MAIN_PUSH_ROUNDS || !REMOTE_HAS_NEW_COMMITS.test(failureOutput(error))) {
				throw error;
			}
		}
		const remoteRef = await syncRemoteBase(worktreePath, 'main', null, credentials);
		try {
			await runGit([
				'-C',
				worktreePath,
				...(await commitConfig(AGENT_IDENTITY)),
				'-c',
				DISABLED_GIT_HOOKS_CONFIG,
				'rebase',
				remoteRef,
			]);
		} catch {
			if ((await inProgressOperation(worktreePath)) === 'rebase') {
				await runGit(['-C', worktreePath, 'rebase', '--abort']);
			}
			throw GitError.git(MAIN_DIVERGED);
		}
	}
	await runGit([
		'-C',
		worktreePath,
		'-c',
		DISABLED_GIT_HOOKS_CONFIG,
		'update-ref',
		'refs/remotes/origin/main',
		'HEAD',
	]);
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

export type CheckoutMove = <T>(move: () => Promise<T>) => Promise<T>;

const unguardedMove: CheckoutMove = (move) => move();

export async function restartWorkstreamOnBase(
	worktreePath: string,
	expectedBranch: string,
	baseBranch: string,
	mergedHeadSha: string,
	expectedRepositoryFullName: string,
	githubToken: string | null | undefined,
	credentials: GitCredentialEnv,
	guardMove: CheckoutMove = unguardedMove,
): Promise<string> {
	validateBaseBranch(baseBranch);
	if (!FULL_COMMIT_ID.test(mergedHeadSha)) {
		throw GitError.git('the merged pull request head must be a full commit id');
	}
	const status = await statusCollector(worktreePath);
	const branch = requireWorkstreamBranch(expectedBranch, status.branch);
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

	await guardMove(async () => {
		try {
			await runGit([
				'-C',
				worktreePath,
				...(await commitConfig()),
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
	});
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
	expectedBranch: string,
	baseBranch: string,
	githubToken: string | null | undefined,
	credentials: GitCredentialEnv,
	guardMove: CheckoutMove = unguardedMove,
): Promise<string> {
	validateBaseBranch(baseBranch);
	const status = await statusCollector(worktreePath);
	const branch = requireWorkstreamBranch(expectedBranch, status.branch);
	if (status.operationInProgress !== null) {
		throw GitError.git(
			`a ${status.operationInProgress} is already in progress in this workstream; finish or abort it before pulling the target branch`,
		);
	}
	if (status.dirtyPaths.length > 0) {
		throw GitError.git('commit or discard local changes before pulling the target branch');
	}
	const remoteRef = await syncRemoteBase(worktreePath, baseBranch, githubToken, credentials);
	await guardMove(() => mergeRemoteRef(worktreePath, remoteRef, branch, 'hold'));
	return (await runGit(['-C', worktreePath, 'rev-parse', '--short', 'HEAD'])).trim();
}

export async function countCommitsBehindBase(
	worktreePath: string,
	expectedBranch: string,
	baseBranch: string,
	githubToken: string | null | undefined,
	credentials: GitCredentialEnv,
): Promise<number> {
	validateBaseBranch(baseBranch);
	requireWorkstreamBranch(expectedBranch, (await statusCollector(worktreePath)).branch);
	const remoteRef = await syncRemoteBase(worktreePath, baseBranch, githubToken, credentials);
	return Number(
		(await runGit(['-C', worktreePath, 'rev-list', '--count', `HEAD..${remoteRef}`])).trim(),
	);
}

export async function abortWorkstreamOperation(
	worktreePath: string,
	expectedBranch: string,
): Promise<void> {
	const status = await statusCollector(worktreePath);
	requireWorkstreamBranch(expectedBranch, status.branch);
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
			...(await commitConfig()),
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

const fetchesByRepository = new Map<string, Promise<string>>();

export async function syncRemoteBase(
	basePath: string,
	baseBranch: string,
	githubToken: string | null | undefined,
	credentials: GitCredentialEnv,
): Promise<string> {
	validateBaseBranch(baseBranch);
	const repository = (
		await runGit(['-C', basePath, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
	).trim();
	const fetching = fetchAfter(fetchesByRepository.get(repository), () =>
		fetchRemoteBase(basePath, baseBranch, githubToken, credentials),
	);
	fetchesByRepository.set(repository, fetching);
	try {
		return await fetching;
	} finally {
		if (fetchesByRepository.get(repository) === fetching) fetchesByRepository.delete(repository);
	}
}

async function fetchAfter(
	previous: Promise<string> | undefined,
	fetch: () => Promise<string>,
): Promise<string> {
	try {
		await previous;
	} catch {}
	return fetch();
}

async function fetchRemoteBase(
	basePath: string,
	baseBranch: string,
	githubToken: string | null | undefined,
	credentials: GitCredentialEnv,
): Promise<string> {
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

export async function fetchRemoteStart(
	basePath: string,
	ref: string,
	githubToken: string | null | undefined,
	credentials: GitCredentialEnv,
): Promise<string> {
	if (!isValidBranchName(ref)) throw GitError.unsafePath(`invalid start ref \`${ref}\``);
	const token = normalizeGithubToken(githubToken);
	const env = await credentials.prepare(token);
	const fetched = `${SNAPSHOT_REF_ROOT}starts/${randomUUID()}`;
	try {
		await runGit(
			[
				'-C',
				basePath,
				...GH_CREDENTIAL_HELPER_CONFIG,
				'-c',
				DISABLED_GIT_HOOKS_CONFIG,
				'fetch',
				'--no-tags',
				'origin',
				`+${ref}:${fetched}`,
			],
			env,
		);
	} catch (error) {
		throw error instanceof GitError ? attributeCredentials(error, token) : error;
	}
	try {
		return (await runGit(['-C', basePath, 'rev-parse', '--verify', `${fetched}^{commit}`])).trim();
	} finally {
		await runGit(['-C', basePath, 'update-ref', '-d', fetched]);
	}
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

export type OriginHead = Readonly<{ branch: string } | { branch: null; empty: boolean }>;

export async function readOriginHead(
	basePath: string,
	githubToken: string | null | undefined,
	credentials: GitCredentialEnv,
): Promise<OriginHead> {
	const listOrigin = await originLister(basePath, githubToken, credentials);
	const branch = headBranchOf(await listOrigin('HEAD'));
	if (branch) return { branch };
	return { branch: null, empty: (await listOrigin('refs/heads/*')).trim().length === 0 };
}

export async function renamedOnOrigin(
	basePath: string,
	branch: string,
	credentials: GitCredentialEnv,
): Promise<string | null> {
	validateBaseBranch(branch);
	const listing = await (
		await originLister(basePath, null, credentials)
	)('HEAD', `refs/heads/${branch}`);
	const head = headBranchOf(listing);
	const kept = listing.split('\n').some((line) => line.endsWith(`\trefs/heads/${branch}`));
	if (!head || head === branch || kept) return null;
	const lastKnown = await recordedRemoteBase(basePath, branch);
	if (lastKnown === null) return null;
	const headRef = await syncRemoteBase(basePath, head, null, credentials);
	return (await isAncestor(basePath, lastKnown, headRef)) ? head : null;
}

async function originLister(
	basePath: string,
	githubToken: string | null | undefined,
	credentials: GitCredentialEnv,
): Promise<(...patterns: string[]) => Promise<string>> {
	const token = normalizeGithubToken(githubToken);
	const env = await credentials.prepare(token);
	return async (...patterns) => {
		try {
			return await runGit(
				[
					'-C',
					basePath,
					...GH_CREDENTIAL_HELPER_CONFIG,
					'ls-remote',
					'--symref',
					'origin',
					...patterns,
				],
				env,
			);
		} catch (error) {
			throw error instanceof GitError ? attributeCredentials(error, token) : error;
		}
	};
}

function headBranchOf(listing: string): string | undefined {
	return /^ref: refs\/heads\/(\S+)\tHEAD$/mu.exec(listing)?.[1];
}

export type CheckoutFastForward = 'current' | 'advanced' | 'diverged';

export async function fastForwardCheckout(
	worktreePath: string,
	targetRef: string,
): Promise<CheckoutFastForward> {
	const head = await headCommit(worktreePath);
	const target = (
		await runGit(['-C', worktreePath, 'rev-parse', '--verify', `${targetRef}^{commit}`])
	).trim();
	if (head === null) {
		const branch = (await runGit(['-C', worktreePath, 'symbolic-ref', '--short', 'HEAD'])).trim();
		await runGit([
			'-C',
			worktreePath,
			'-c',
			DISABLED_GIT_HOOKS_CONFIG,
			'checkout',
			'-q',
			'-B',
			branch,
			target,
		]);
		return 'advanced';
	}
	if (head === target) return 'current';
	if (!(await isAncestor(worktreePath, head, target))) return 'diverged';
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

async function headCommit(worktreePath: string): Promise<string | null> {
	try {
		return (await runGit(['-C', worktreePath, 'rev-parse', '--verify', '--quiet', 'HEAD'])).trim();
	} catch (error) {
		if (error instanceof GitError && error.exitCode === 1) return null;
		throw error;
	}
}

async function isAncestor(worktreePath: string, commit: string, of: string): Promise<boolean> {
	try {
		await runGit(['-C', worktreePath, 'merge-base', '--is-ancestor', commit, of]);
		return true;
	} catch (error) {
		if (error instanceof GitError && error.exitCode === 1) return false;
		throw error;
	}
}
