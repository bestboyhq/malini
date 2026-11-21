import { existsSync } from 'node:fs';
import {
	lstat,
	mkdir,
	mkdtemp,
	open,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	statfs,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { CheckoutFinding } from '$contract/repositories';
import { errorCode, isGitError, isNotFoundError } from '$main/errors';
import { MINIMUM_FREE_BYTES, requireFreeSpace } from '$main/fs/free-space';
import { isAtOrInsideDirectory } from '$main/fs/paths';
import { restoreArchivedWork } from '$main/git/archived-work';
import { ensureAppManagedGitExcludes } from '$main/git/excludes';
import { deriveProjectId, WORKTREE_CONTENT_PATHSPEC } from '$main/git/paths';
import { runGit, runGitAllowingExit } from '$main/git/run';
import { SNAPSHOT_REF_ROOT } from '$main/git/snapshots';
import {
	cleanupFailedWorktreeAdd,
	repairWorktreeLinks,
	withProjectLock,
} from '$main/git/worktrees';
import { resolveToolPath } from '$main/process/environment';
import { runBounded, type ProcessRunner } from '$main/process/runner';

export const STALE_LOCK_MS = 2 * 60_000;
const FULL_DISK_BYTES = 64 * 1024 * 1024;
const LSOF_BUDGET_MS = 5_000;
const REPAIRS_DIR_NAME = 'malini-repairs';
const INDEX_SIGNATURE = 'DIRC';
const GITDIR_LINE = /^gitdir:\s*(.+)$/mu;
const HEAD_CONTENT = /^(?:ref: refs\/\S+|[0-9a-f]{40}|[0-9a-f]{64})\s*$/u;
const MISSING = new Set(['ENOENT', 'ENOTDIR']);
const DENIED = new Set(['EACCES', 'EPERM']);
const LINK_FINDINGS: ReadonlySet<CheckoutFinding | null> = new Set([
	'git-link-missing',
	'admin-missing',
]);

const SAID_FINDINGS: ReadonlyMap<string, CheckoutFinding> = new Map([
	['dubious-ownership', 'dubious-ownership'],
	['developer-tools-missing', 'developer-tools-missing'],
	['license-not-accepted', 'developer-tools-missing'],
	['no-space', 'disk-full'],
	['permission-denied', 'permission-denied'],
	['index-corrupt', 'index-corrupt'],
	['head-invalid', 'head-invalid'],
	['unknown-revision', 'head-invalid'],
]);

export interface CheckoutCase {
	readonly checkout: string;
	readonly repository: string | null;
	readonly branch: string;
	readonly snapshotRefs: readonly string[];
	readonly baseStart: (repository: string) => Promise<string>;
	readonly runner: ProcessRunner;
}

interface Examination {
	readonly finding: CheckoutFinding | null;
	readonly admin: string | null;
}

export async function diagnoseCheckout(c: CheckoutCase): Promise<CheckoutFinding | null> {
	return (await examine(c)).finding;
}

export async function repairCheckout(c: CheckoutCase): Promise<void> {
	const { finding, admin } = await examine(c);
	const { repository } = c;
	if (repository === null) return;
	if (finding === 'folder-missing') await recreateCheckout(c, repository);
	if (LINK_FINDINGS.has(finding)) await relinkCheckout(c, repository);
	if (admin === null) return;
	if (finding === 'stale-lock') await keep(repository, join(admin, 'index.lock'));
	if (finding === 'index-corrupt') await rebuildIndex(c.checkout, repository, admin);
	if (finding === 'head-invalid') await pointHeadAtBranch(c, repository, admin);
}

async function examine(c: CheckoutCase): Promise<Examination> {
	const found = (finding: CheckoutFinding): Examination => ({
		finding:
			c.repository === null && finding !== 'permission-denied'
				? 'base-repository-missing'
				: finding,
		admin: null,
	});
	const folder = await failureCode(lstat(c.checkout));
	if (folder !== null) return found(fileFinding(folder, 'folder-missing'));
	const link = await readText(join(c.checkout, '.git'));
	if (link.code === 'EISDIR') return { finding: await gitAnswer(c), admin: null };
	if (link.code !== null) return found(fileFinding(link.code, 'git-link-missing'));
	const gitdir = GITDIR_LINE.exec(link.text)?.[1]?.trim();
	if (!gitdir) return found('git-link-missing');
	const admin = resolve(c.checkout, gitdir);
	const adminCode = await failureCode(lstat(admin));
	if (adminCode !== null) return found(fileFinding(adminCode, 'admin-missing'));
	if (await diskFull(c.checkout)) return { finding: 'disk-full', admin };
	if (await staleLock(c, admin)) return { finding: 'stale-lock', admin };
	const index = await indexFinding(admin);
	if (index !== null) return { finding: index, admin };
	const head = await readText(join(admin, 'HEAD'));
	if (head.code !== null) return { finding: fileFinding(head.code, 'head-invalid'), admin };
	if (!HEAD_CONTENT.test(head.text)) return { finding: 'head-invalid', admin };
	const answer = await gitAnswer(c);
	if (answer === null || (await ownedByMe(c))) return { finding: answer, admin };
	return { finding: 'dubious-ownership', admin };
}

function fileFinding(code: string, missing: CheckoutFinding): CheckoutFinding {
	if (MISSING.has(code)) return missing;
	return DENIED.has(code) ? 'permission-denied' : 'unknown';
}

async function failureCode(operation: Promise<unknown>): Promise<string | null> {
	try {
		await operation;
		return null;
	} catch (error) {
		return errorCode(error) ?? 'unknown';
	}
}

async function readText(
	path: string,
): Promise<{ readonly text: string; readonly code: string | null }> {
	try {
		return { text: await readFile(path, 'utf8'), code: null };
	} catch (error) {
		return { text: '', code: errorCode(error) ?? 'unknown' };
	}
}

async function diskFull(path: string): Promise<boolean> {
	try {
		const { bavail, bsize } = await statfs(path);
		return bavail * bsize < FULL_DISK_BYTES;
	} catch {
		return false;
	}
}

async function staleLock(c: CheckoutCase, admin: string): Promise<boolean> {
	const lock = join(admin, 'index.lock');
	const stats = await lstat(lock).catch(() => null);
	if (stats === null || Date.now() - stats.mtimeMs < STALE_LOCK_MS) return false;
	return !(await gitHoldsLock(c.runner, lock, [c.checkout, admin]));
}

async function gitHoldsLock(
	runner: ProcessRunner,
	lock: string,
	folders: readonly string[],
): Promise<boolean> {
	const lsof = resolveToolPath('lsof') ?? '/usr/sbin/lsof';
	const deadline = Date.now() + LSOF_BUDGET_MS;
	try {
		const open = await runBounded(runner, lsof, ['-t', '--', lock], { deadline });
		if (open.exitCode !== 1) return true;
		const cwd = await runBounded(runner, lsof, ['-a', '-c', 'git', '-d', 'cwd', '-F', 'n'], {
			deadline,
		});
		if (cwd.exitCode === 1) return false;
		if (cwd.exitCode !== 0) return true;
		const roots = await Promise.all(folders.map(canonicalPath));
		return cwd.stdout
			.split('\n')
			.filter((line) => line.startsWith('n'))
			.some((line) => roots.some((root) => isAtOrInsideDirectory(root, line.slice(1))));
	} catch {
		return true;
	}
}

async function indexFinding(admin: string): Promise<CheckoutFinding | null> {
	let index;
	try {
		index = await open(join(admin, 'index'), 'r');
	} catch (error) {
		const code = errorCode(error) ?? 'unknown';
		return code === 'ENOENT' ? null : fileFinding(code, 'index-corrupt');
	}
	try {
		const { buffer, bytesRead } = await index.read(Buffer.alloc(4), 0, 4, 0);
		return bytesRead === 4 && buffer.toString('latin1') === INDEX_SIGNATURE
			? null
			: 'index-corrupt';
	} finally {
		await index.close();
	}
}

async function gitAnswer(c: CheckoutCase): Promise<CheckoutFinding | null> {
	try {
		await runGitAllowingExit(
			['-C', c.checkout, 'diff-index', '--cached', '--quiet', 'HEAD', '--'],
			1,
		);
		return null;
	} catch (error) {
		if (isGitError(error, 'git-unavailable')) return 'git-unavailable';
		if (isNotFoundError(error)) return 'folder-missing';
		if (!isGitError(error, 'git')) return 'unknown';
		return SAID_FINDINGS.get(String(error.facts['said'])) ?? 'unknown';
	}
}

async function ownedByMe(c: CheckoutCase): Promise<boolean> {
	const me = process.getuid?.();
	if (me === undefined) return true;
	const folders = [c.checkout, ...(c.repository === null ? [] : [c.repository])];
	const owners = await Promise.all(folders.map(async (folder) => (await lstat(folder)).uid));
	return owners.every((owner) => owner === me);
}

async function recreateCheckout(c: CheckoutCase, repository: string): Promise<void> {
	for (const admin of await adminsLinkedTo(repository, c.checkout)) await keep(repository, admin);
	await requireFreeSpace(c.checkout, MINIMUM_FREE_BYTES, 'repairing this checkout');
	const branchExisted = await refExists(repository, `refs/heads/${c.branch}`);
	try {
		await restoreArchivedWork({
			repository,
			checkout: c.checkout,
			branch: c.branch,
			savedRef: null,
			baseStart: () => c.baseStart(repository),
		});
	} catch (error) {
		await cleanupFailedWorktreeAdd(repository, c.checkout, c.branch, false, branchExisted);
		throw error;
	}
	await restoreNewestSnapshot(c, repository);
	await ensureAppManagedGitExcludes(c.checkout);
}

async function restoreNewestSnapshot(c: CheckoutCase, repository: string): Promise<void> {
	const head = (await runGit(['-C', c.checkout, 'rev-parse', 'HEAD'])).trim();
	const ours = new Set(c.snapshotRefs);
	const listed = await runGit([
		'-C',
		repository,
		'for-each-ref',
		'--sort=-committerdate',
		'--format=%(refname) %(objectname) %(parent)',
		SNAPSHOT_REF_ROOT,
	]);
	const newest = listed
		.split('\n')
		.map((line) => line.split(' '))
		.find(([ref = '', , parent]) => ours.has(ref) && parent === head);
	if (newest?.[1] === undefined) return;
	await runGit([
		'-C',
		c.checkout,
		'restore',
		`--source=${newest[1]}`,
		'--worktree',
		'--',
		WORKTREE_CONTENT_PATHSPEC,
	]);
}

async function relinkCheckout(c: CheckoutCase, repository: string): Promise<void> {
	await repairWorktreeLinks(repository).catch(() => undefined);
	if (!LINK_FINDINGS.has((await examine(c)).finding)) return;
	const [admin] = await adminsLinkedTo(repository, c.checkout);
	if (admin !== undefined) {
		await linkTo(c.checkout, repository, admin);
		return;
	}
	const scratch = await mkdtemp(join(tmpdir(), 'malini-relink-'));
	try {
		const placeholder = join(scratch, basename(c.checkout));
		const kept = await refExists(repository, `refs/heads/${c.branch}`);
		const target = kept
			? [placeholder, c.branch]
			: ['-b', c.branch, placeholder, await c.baseStart(repository)];
		await withProjectLock(deriveProjectId(repository), () =>
			runGit(['-C', repository, 'worktree', 'add', '--no-checkout', ...target]),
		);
		await linkTo(c.checkout, repository, await linkedAdmin(placeholder));
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
	await runGit(['-C', c.checkout, 'read-tree', 'HEAD']);
	await runGit(['-C', c.checkout, 'update-index', '-q', '--refresh']);
}

async function linkTo(checkout: string, repository: string, admin: string): Promise<void> {
	await writeFile(join(checkout, '.git'), `gitdir: ${admin}\n`);
	await repairWorktreeLinks(repository, [checkout]);
}

async function linkedAdmin(checkout: string): Promise<string> {
	const gitdir = GITDIR_LINE.exec(await readFile(join(checkout, '.git'), 'utf8'))?.[1]?.trim();
	return resolve(checkout, gitdir ?? '');
}

async function rebuildIndex(checkout: string, repository: string, admin: string): Promise<void> {
	await keep(repository, join(admin, 'index'));
	await runGit(['-C', checkout, 'read-tree', 'HEAD']);
	await runGit(['-C', checkout, 'update-index', '-q', '--refresh']);
}

async function pointHeadAtBranch(
	c: CheckoutCase,
	repository: string,
	admin: string,
): Promise<void> {
	const branch = `refs/heads/${c.branch}`;
	if (!(await refExists(repository, branch))) return;
	const head = join(admin, 'HEAD');
	if (existsSync(head)) await keep(repository, head);
	await writeFile(head, `ref: ${branch}\n`);
}

async function adminsLinkedTo(repository: string, checkout: string): Promise<string[]> {
	const worktrees = join(await commonDir(repository), 'worktrees');
	const dotGit = join(await canonicalPath(checkout), '.git');
	const linked: string[] = [];
	for (const name of await readdir(worktrees).catch(() => [])) {
		const admin = join(worktrees, name);
		const backlink = (await readFile(join(admin, 'gitdir'), 'utf8').catch(() => '')).trim();
		if (backlink && (await canonicalPath(resolve(admin, backlink))) === dotGit) linked.push(admin);
	}
	return linked;
}

async function keep(repository: string, path: string): Promise<void> {
	const kept = join(await commonDir(repository), REPAIRS_DIR_NAME);
	await mkdir(kept, { recursive: true });
	await rename(path, join(kept, `${Date.now()}-${basename(path)}`));
}

async function commonDir(repository: string): Promise<string> {
	return (
		await runGit(['-C', repository, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
	).trim();
}

async function refExists(repository: string, ref: string): Promise<boolean> {
	try {
		await runGit(['-C', repository, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
		return true;
	} catch {
		return false;
	}
}

async function canonicalPath(path: string): Promise<string> {
	const real = await realpath(path).catch(() => null);
	if (real !== null) return real;
	const parent = dirname(path);
	return parent === path ? path : join(await canonicalPath(parent), basename(path));
}
