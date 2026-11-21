import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { MaliniError, type ErrorVerdicts } from '$main/errors';
import { retryingVanishedFileRace, withTemporaryIndex } from './diff';
import { ensureStagingPrecondition } from './excludes';
import { WORKTREE_CONTENT_PATHSPEC, deriveProjectId, validateWorkstreamId } from './paths';
import {
	DISABLED_GIT_HOOKS_CONFIG,
	EXACT_CONTENT_CONFIG,
	runGit,
	runGitAllowingExit,
	runGitWithInput,
	type GitEnv,
} from './run';
import { AGENT_IDENTITY, SNAPSHOT_REF_ROOT } from './snapshots';
import { populateCheckout, withProjectLock } from './worktrees';

export const ARCHIVED_WORK_REF_NAMESPACE = `${SNAPSHOT_REF_ROOT}archived/`;

const ARCHIVE_COMMIT_IDENTITY: GitEnv = {
	GIT_AUTHOR_NAME: AGENT_IDENTITY.name,
	GIT_AUTHOR_EMAIL: AGENT_IDENTITY.email,
	GIT_COMMITTER_NAME: AGENT_IDENTITY.name,
	GIT_COMMITTER_EMAIL: AGENT_IDENTITY.email,
};

const GITLINK_MODE = '160000';
const BLOB = 'blob';
const IGNORE_FILE = '.gitignore';

const UNCOMMITTED_WORK_SUBJECT = 'malini: uncommitted work saved when archiving';
const LOCAL_WORK_SUBJECT = 'malini: local work saved when archiving';

export interface LocalWorkSource {
	readonly repository: string;
	readonly branch: string;
	readonly baseBranch: string | null;
	readonly checkout: string | null;
}

export interface ArchivedWork {
	readonly ref: string;
	readonly commit: string;
	readonly uncommitted: boolean;
	readonly commits: number;
}

export type NestedRepositoryWork = 'uncommitted' | 'unpushed';

const NESTED_REPOSITORY_WORK_VERDICTS: ErrorVerdicts<NestedRepositoryWork> = {
	uncommitted: 'expected',
	unpushed: 'expected',
};

export class NestedRepositoryWorkError extends MaliniError<NestedRepositoryWork> {
	readonly path: string;
	readonly work: NestedRepositoryWork;

	constructor(path: string, work: NestedRepositoryWork) {
		super(
			'NestedRepositoryWorkError',
			NESTED_REPOSITORY_WORK_VERDICTS,
			work,
			work === 'uncommitted'
				? `the nested repository ${path} has uncommitted changes`
				: `the nested repository ${path} has commits that are on no remote`,
		);
		this.path = path;
		this.work = work;
	}
}

type CheckoutGit = (args: readonly string[], env?: GitEnv) => Promise<string>;

export async function saveLocalOnlyWork(
	workstreamId: string,
	source: LocalWorkSource,
): Promise<ArchivedWork | null> {
	validateWorkstreamId(workstreamId);
	const keepers = await refsThatKeepWork(source.repository, source.baseBranch);
	const checkoutHead = source.checkout ? await checkedOutCommit(source.checkout) : null;
	const branchTip = await verifiedCommit(source.repository, `refs/heads/${source.branch}`);
	const base = checkoutHead ?? branchTip;
	const unkeptTips = await outermostTips(
		source.repository,
		await tipsNotKeptBy(source.repository, [checkoutHead, branchTip], keepers),
	);
	const wipTree = source.checkout ? await uncommittedTree(source, source.checkout, base) : null;
	const commit = await archivedCommit(source.repository, wipTree, base, unkeptTips);
	if (commit === null) return null;
	const commits = await commitCount(source.repository, unkeptTips, keepers);
	const ref = await writeArchivedRef(source.repository, workstreamId, commit);
	return { ref, commit, uncommitted: wipTree !== null, commits };
}

export async function branchWorkIsKept(
	repository: string,
	branch: string,
	baseBranch: string | null,
	savedRef: string | null,
): Promise<boolean> {
	const tip = await verifiedCommit(repository, `refs/heads/${branch}`);
	if (tip === null) return true;
	const keepers = await refsThatKeepWork(repository, baseBranch);
	if (savedRef !== null && (await verifiedCommit(repository, savedRef)) !== null) {
		keepers.push(savedRef);
	}
	return keepers.length > 0 && (await commitCount(repository, [tip], keepers)) === 0;
}

interface TreeEntry {
	readonly type: string;
	readonly object: string;
}

export async function filesSavedOrIgnored(
	repository: string,
	refs: readonly string[],
	folder: string,
	files: ReadonlyArray<Readonly<{ path: string; regular: boolean }>>,
): Promise<ReadonlySet<string>> {
	const commit = await firstCommit(repository, refs);
	if (commit === null || files.length === 0) return new Set();
	const tree = await treeEntries(repository, commit);
	const paths = files.map(({ path }) => path);
	const ignored = await ignoredPaths(repository, tree, paths);
	const unignored = files.flatMap(({ path, regular }) =>
		regular && !ignored.has(path) && !path.includes('\n') && tree.get(path)?.type === BLOB
			? [path]
			: [],
	);
	return new Set([...ignored, ...(await savedPaths(repository, folder, tree, unignored))]);
}

async function firstCommit(repository: string, refs: readonly string[]): Promise<string | null> {
	for (const ref of refs) {
		const commit = await verifiedCommit(repository, ref);
		if (commit !== null) return commit;
	}
	return null;
}

// ponytail: lists the whole tree in one call under git's 32 MB output cap; pass the leftover paths to ls-tree if a repository outgrows it
async function treeEntries(repository: string, commit: string): Promise<Map<string, TreeEntry>> {
	const listed = await runGit(['-C', repository, 'ls-tree', '-r', '-z', '--full-tree', commit]);
	const entries = new Map<string, TreeEntry>();
	for (const line of listed.split('\0')) {
		const tab = line.indexOf('\t');
		if (tab === -1) continue;
		const [, type, object] = line.slice(0, tab).split(' ');
		if (type === undefined || object === undefined) continue;
		entries.set(line.slice(tab + 1), { type, object });
	}
	return entries;
}

async function ignoredPaths(
	repository: string,
	tree: ReadonlyMap<string, TreeEntry>,
	paths: readonly string[],
): Promise<Set<string>> {
	const commonDir = (
		await runGit(['-C', repository, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
	).trim();
	const rules = await mkdtemp(join(tmpdir(), 'malini-ignore-rules-'));
	try {
		for (const [path, { type, object }] of tree) {
			if (type !== BLOB || basename(path) !== IGNORE_FILE) continue;
			await mkdir(dirname(join(rules, path)), { recursive: true });
			await writeFile(
				join(rules, path),
				await runGit(['-C', repository, 'cat-file', 'blob', object]),
			);
		}
		const { stdout } = await runGitAllowingExit(
			[
				'-C',
				rules,
				`--git-dir=${commonDir}`,
				`--work-tree=${rules}`,
				'check-ignore',
				'--no-index',
				'-z',
				'--stdin',
			],
			1,
			paths.join('\0'),
		);
		return new Set(stdout.split('\0').filter((path) => path !== ''));
	} finally {
		await rm(rules, { recursive: true, force: true });
	}
}

async function savedPaths(
	repository: string,
	folder: string,
	tree: ReadonlyMap<string, TreeEntry>,
	paths: readonly string[],
): Promise<string[]> {
	if (paths.length === 0) return [];
	const hashes = (
		await runGitWithInput(
			['-C', repository, 'hash-object', '--no-filters', '--stdin-paths'],
			paths.map((path) => `${join(folder, path)}\n`).join(''),
		)
	).split('\n');
	return paths.filter((path, index) => hashes[index] === tree.get(path)?.object);
}

export interface ArchivedWorkRestore {
	readonly repository: string;
	readonly checkout: string;
	readonly branch: string;
	readonly savedRef: string | null;
	readonly baseStart: () => Promise<string>;
}

interface SavedWork {
	readonly commit: string;
	readonly head: string | null;
	readonly uncommitted: boolean;
	readonly tips: readonly string[];
}

export async function restoreArchivedWork(restore: ArchivedWorkRestore): Promise<void> {
	const { repository, checkout, branch } = restore;
	const saved = restore.savedRef === null ? null : await savedWorkAt(repository, restore.savedRef);
	const branchKept = (await verifiedCommit(repository, `refs/heads/${branch}`)) !== null;
	const target = branchKept
		? [checkout, branch]
		: ['-b', branch, checkout, saved?.head ?? (await restore.baseStart())];
	await withProjectLock(deriveProjectId(repository), () =>
		runGit(['-C', repository, 'worktree', 'add', '--no-checkout', ...target]),
	);
	await populateCheckout(repository, checkout);
	if (saved?.uncommitted !== true) return;
	const changed = await runGit([
		'-C',
		checkout,
		'diff',
		'--name-only',
		'-z',
		'--no-renames',
		'HEAD',
		saved.commit,
		'--',
		WORKTREE_CONTENT_PATHSPEC,
	]);
	if (changed.length === 0) return;
	await runGitWithInput(
		[
			'-C',
			checkout,
			'--literal-pathspecs',
			'-c',
			EXACT_CONTENT_CONFIG,
			'restore',
			`--source=${saved.commit}`,
			'--worktree',
			'--pathspec-from-file=-',
			'--pathspec-file-nul',
		],
		changed,
	);
}

export async function releaseRestoredWork(
	repository: string,
	branch: string,
	savedRef: string,
): Promise<void> {
	if (!savedRef.startsWith(ARCHIVED_WORK_REF_NAMESPACE)) return;
	const saved = await savedWorkAt(repository, savedRef);
	if (saved === null) return;
	if ((await commitCount(repository, saved.tips, [`refs/heads/${branch}`])) > 0) return;
	await runGit(['-C', repository, 'update-ref', '-d', savedRef, saved.commit]);
}

async function savedWorkAt(repository: string, ref: string): Promise<SavedWork | null> {
	const commit = await verifiedCommit(repository, ref);
	if (commit === null) return null;
	const [subject, email, parents = ''] = (
		await runGit(['-C', repository, 'show', '-s', '--format=%s%x00%ae%x00%P', commit])
	)
		.trim()
		.split('\0');
	const madeByArchive =
		email === AGENT_IDENTITY.email &&
		(subject === UNCOMMITTED_WORK_SUBJECT || subject === LOCAL_WORK_SUBJECT);
	if (!madeByArchive) return { commit, head: commit, uncommitted: false, tips: [commit] };
	const tips = parents.split(' ').filter(Boolean);
	return { commit, head: tips[0] ?? null, uncommitted: subject === UNCOMMITTED_WORK_SUBJECT, tips };
}

async function checkedOutCommit(checkout: string): Promise<string | null> {
	if (!existsSync(join(checkout, '.git'))) return null;
	return verifiedCommit(checkout, 'HEAD');
}

async function tipsNotKeptBy(
	repository: string,
	tips: ReadonlyArray<string | null>,
	keepers: readonly string[],
): Promise<string[]> {
	const unkept: string[] = [];
	for (const tip of new Set(tips)) {
		if (tip === null) continue;
		if (keepers.length > 0 && (await commitCount(repository, [tip], keepers)) === 0) continue;
		unkept.push(tip);
	}
	return unkept;
}

async function outermostTips(repository: string, tips: readonly string[]): Promise<string[]> {
	const outermost: string[] = [];
	for (const tip of tips) {
		const others = tips.filter((other) => other !== tip);
		if (others.length > 0 && (await commitCount(repository, [tip], others)) === 0) continue;
		outermost.push(tip);
	}
	return outermost;
}

async function archivedCommit(
	repository: string,
	wipTree: string | null,
	base: string | null,
	unkeptTips: readonly string[],
): Promise<string | null> {
	if (wipTree !== null) {
		const parents =
			base === null ? [...unkeptTips] : [base, ...unkeptTips.filter((tip) => tip !== base)];
		return commitTree(repository, wipTree, parents, UNCOMMITTED_WORK_SUBJECT);
	}
	const [only, ...more] = unkeptTips;
	if (only === undefined) return null;
	if (more.length === 0) return only;
	const tree = (await runGit(['-C', repository, 'rev-parse', `${only}^{tree}`])).trim();
	return commitTree(repository, tree, unkeptTips, LOCAL_WORK_SUBJECT);
}

async function commitTree(
	repository: string,
	tree: string,
	parents: readonly string[],
	message: string,
): Promise<string> {
	return (
		await runGit(
			[
				'-C',
				repository,
				'commit-tree',
				tree,
				...parents.flatMap((parent) => ['-p', parent]),
				'-m',
				message,
			],
			ARCHIVE_COMMIT_IDENTITY,
		)
	).trim();
}

async function uncommittedTree(
	source: LocalWorkSource,
	checkout: string,
	base: string | null,
): Promise<string | null> {
	const commonDir = (
		await runGit([
			'-C',
			source.repository,
			'rev-parse',
			'--path-format=absolute',
			'--git-common-dir',
		])
	).trim();
	const linked = existsSync(join(checkout, '.git'));
	if (linked) await ensureStagingPrecondition(checkout);
	const realIndex = linked ? await checkoutIndexPath(checkout) : null;
	return retryingVanishedFileRace(() => stagedCheckoutTree(checkout, commonDir, realIndex, base));
}

function stagedCheckoutTree(
	checkout: string,
	commonDir: string,
	realIndex: string | null,
	base: string | null,
): Promise<string | null> {
	return withTemporaryIndex(async (index) => {
		const git: CheckoutGit = (args, env = {}) =>
			runGit(
				[
					'-C',
					checkout,
					`--git-dir=${commonDir}`,
					`--work-tree=${checkout}`,
					'-c',
					DISABLED_GIT_HOOKS_CONFIG,
					'-c',
					EXACT_CONTENT_CONFIG,
					...args,
				],
				{ ...index.env(), ...env },
			);
		if (realIndex !== null) {
			await copyFile(realIndex, index.path);
		} else {
			await git(base === null ? ['read-tree', '--empty'] : ['read-tree', base]);
		}
		const nested = await nestedRepositories(git, checkout);
		for (const path of nested) await refuseNestedWork(checkout, path);
		await git([
			'add',
			'-A',
			'--',
			WORKTREE_CONTENT_PATHSPEC,
			...nested.map((path) => `:(top,literal,exclude)${path}`),
		]);
		const tree = (await git(['write-tree'])).trim();
		if (base === null) {
			return (await git(['ls-files', '--cached'])).trim().length === 0 ? null : tree;
		}
		return tree === (await git(['rev-parse', `${base}^{tree}`])).trim() ? null : tree;
	});
}

async function checkoutIndexPath(checkout: string): Promise<string | null> {
	try {
		const reported = (
			await runGit(['-C', checkout, 'rev-parse', '--path-format=absolute', '--git-path', 'index'])
		).trim();
		if (reported.length === 0) return null;
		const path = isAbsolute(reported) ? reported : join(checkout, reported);
		return (await stat(path)).isFile() ? path : null;
	} catch {
		return null;
	}
}

async function nestedRepositories(git: CheckoutGit, checkout: string): Promise<string[]> {
	const gitlinks = (await git(['ls-files', '--stage', '-z']))
		.split('\0')
		.filter((entry) => entry.startsWith(`${GITLINK_MODE} `))
		.map((entry) => entry.slice(entry.indexOf('\t') + 1));
	const untracked = (await git(['ls-files', '--others', '--exclude-standard', '-z']))
		.split('\0')
		.filter((entry) => entry.endsWith('/'))
		.map((entry) => entry.slice(0, -1))
		.filter((path) => existsSync(join(checkout, path, '.git')));
	return [...new Set([...gitlinks, ...untracked])];
}

async function refuseNestedWork(checkout: string, path: string): Promise<void> {
	const nested = join(checkout, path);
	if (!existsSync(join(nested, '.git'))) return;
	const changes = await runGit(['-C', nested, 'status', '--porcelain', '--untracked-files=all']);
	if (changes.trim().length > 0) throw new NestedRepositoryWorkError(path, 'uncommitted');
	if ((await verifiedCommit(nested, 'HEAD')) === null) return;
	const unpushed = await runGit([
		'-C',
		nested,
		'rev-list',
		'--count',
		'HEAD',
		'--branches',
		'--not',
		'--remotes',
	]);
	if ((Number.parseInt(unpushed.trim(), 10) || 0) > 0) {
		throw new NestedRepositoryWorkError(path, 'unpushed');
	}
}

async function commitCount(
	repository: string,
	tips: readonly string[],
	keepers: readonly string[],
): Promise<number> {
	if (tips.length === 0) return 0;
	const counted = await runGit([
		'-C',
		repository,
		'rev-list',
		'--count',
		...tips,
		...(keepers.length > 0 ? ['--not', ...keepers] : []),
	]);
	return Number.parseInt(counted.trim(), 10) || 0;
}

async function refsThatKeepWork(repository: string, baseBranch: string | null): Promise<string[]> {
	if (!baseBranch) return [];
	const keepers: string[] = [];
	for (const candidate of [`refs/remotes/origin/${baseBranch}`, `refs/heads/${baseBranch}`]) {
		if ((await verifiedCommit(repository, candidate)) !== null) keepers.push(candidate);
	}
	return keepers;
}

async function writeArchivedRef(
	repository: string,
	workstreamId: string,
	commit: string,
): Promise<string> {
	const ref = `${ARCHIVED_WORK_REF_NAMESPACE}${workstreamId}`;
	const existing = await verifiedCommit(repository, ref);
	if (existing === null) {
		await runGit(['-C', repository, 'update-ref', ref, commit, '']);
		return ref;
	}
	if ((await commitCount(repository, [commit], [existing])) === 0) return ref;
	const another = `${ref}-${Date.now()}`;
	await runGit(['-C', repository, 'update-ref', another, commit, '']);
	return another;
}

async function verifiedCommit(repository: string, ref: string): Promise<string | null> {
	try {
		const sha = (
			await runGit(['-C', repository, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
		).trim();
		return sha.length > 0 ? sha : null;
	} catch {
		return null;
	}
}
