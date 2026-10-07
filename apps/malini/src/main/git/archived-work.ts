import { existsSync } from 'node:fs';
import { copyFile, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { retryingVanishedFileRace, withTemporaryIndex } from './diff';
import { ensureStagingPrecondition } from './excludes';
import { WORKTREE_CONTENT_PATHSPEC, validateWorkstreamId } from './paths';
import { DISABLED_GIT_HOOKS_CONFIG, runGit, type GitEnv } from './run';
import { AGENT_IDENTITY, SNAPSHOT_REF_ROOT } from './snapshots';

export const ARCHIVED_WORK_REF_NAMESPACE = `${SNAPSHOT_REF_ROOT}archived/`;

const ARCHIVE_COMMIT_IDENTITY: GitEnv = {
	GIT_AUTHOR_NAME: AGENT_IDENTITY.name,
	GIT_AUTHOR_EMAIL: AGENT_IDENTITY.email,
	GIT_COMMITTER_NAME: AGENT_IDENTITY.name,
	GIT_COMMITTER_EMAIL: AGENT_IDENTITY.email,
};

const GITLINK_MODE = '160000';

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

export class NestedRepositoryWorkError extends Error {
	override readonly name = 'NestedRepositoryWorkError';
	readonly path: string;
	readonly work: NestedRepositoryWork;

	constructor(path: string, work: NestedRepositoryWork) {
		super(
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
	if (wipTree === null && unkeptTips.length === 0) return null;
	const commit = await archivedCommit(source.repository, wipTree, base, unkeptTips);
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
): Promise<string> {
	if (wipTree !== null) {
		const parents =
			base === null ? [...unkeptTips] : [base, ...unkeptTips.filter((tip) => tip !== base)];
		return commitTree(
			repository,
			wipTree,
			parents,
			'malini: uncommitted work saved when archiving',
		);
	}
	const [only, ...more] = unkeptTips;
	if (only === undefined) throw new Error('there was no work to save');
	if (more.length === 0) return only;
	const tree = (await runGit(['-C', repository, 'rev-parse', `${only}^{tree}`])).trim();
	return commitTree(repository, tree, unkeptTips, 'malini: local work saved when archiving');
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
