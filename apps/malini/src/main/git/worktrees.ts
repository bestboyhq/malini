import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { lstat, mkdir, realpath, rm } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import {
	deriveBranchFromPath,
	deriveProjectId,
	validateBranch,
	WORKSTREAM_BRANCH_PREFIX,
} from './paths';
import { describeError, GitError } from '$main/errors';
import { cloneInto } from '$main/fs/copy-on-write';
import { isInsideDirectory } from '$main/fs/paths';
import { fastForwardCheckout } from './remote';
import { runGit } from './run';

const projectLocks = new Map<string, Promise<void>>();

const execFileAsync = promisify(execFile);

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return (
		typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
	);
}

export async function withProjectLock<T>(projectId: string, body: () => Promise<T>): Promise<T> {
	const previous = projectLocks.get(projectId) ?? Promise.resolve();
	let release: () => void = () => undefined;
	const current = new Promise<void>((resolve) => {
		release = resolve;
	});
	const chained = (async () => {
		await previous;
		await current;
	})();
	projectLocks.set(projectId, chained);
	await previous;
	try {
		return await body();
	} finally {
		release();
		if (projectLocks.get(projectId) === chained) projectLocks.delete(projectId);
	}
}

export interface GitWorktree {
	path: string;
	head: string | null;
	branch: string | null;
	bare: boolean;
	detached: boolean;
	locked: boolean;
	prunable: boolean;
}

export function parseWorktreeListPorcelain(stdout: string): GitWorktree[] {
	const entries: GitWorktree[] = [];
	let current: GitWorktree | null = null;
	for (const rawLine of stdout.split('\n')) {
		const line = rawLine.trimEnd();
		if (line.length === 0) continue;
		const space = line.indexOf(' ');
		const keyword = space === -1 ? line : line.slice(0, space);
		const value = space === -1 ? null : line.slice(space + 1);
		if (keyword === 'worktree') {
			if (current) entries.push(current);
			current = {
				path: value ?? '',
				head: null,
				branch: null,
				bare: false,
				detached: false,
				locked: false,
				prunable: false,
			};
			continue;
		}
		if (!current) continue;
		switch (keyword) {
			case 'HEAD':
				current.head = value;
				break;
			case 'branch':
				current.branch = value;
				break;
			case 'bare':
				current.bare = true;
				break;
			case 'detached':
				current.detached = true;
				break;
			case 'locked':
				current.locked = true;
				break;
			case 'prunable':
				current.prunable = true;
				break;
			default:
				break;
		}
	}
	if (current) entries.push(current);
	return entries;
}

export async function listWorktrees(repository: string): Promise<GitWorktree[]> {
	const stdout = await runGit(['-C', repository, 'worktree', 'list', '--porcelain']);
	return parseWorktreeListPorcelain(stdout);
}

export async function branchList(repoPath: string): Promise<string[]> {
	const out = await runGit(['-C', repoPath, 'branch', '--list', '--format=%(refname:short)']);
	return out
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

export function isBranchCollision(message: string): boolean {
	const lowered = message.toLowerCase();
	return (
		(lowered.includes('a branch named') && lowered.includes('already exists')) ||
		lowered.includes('is already checked out at')
	);
}

export async function addWorktree(
	basePath: string,
	worktreePath: string,
	branchName: string,
	baseBranch: string,
): Promise<void> {
	validateBranch(branchName);
	await withProjectLock(deriveProjectId(basePath), async () => {
		await advanceBaseCheckout(basePath);
		try {
			await runGit([
				'-C',
				basePath,
				'worktree',
				'add',
				'--no-checkout',
				worktreePath,
				'-b',
				branchName,
				baseBranch,
			]);
		} catch (error) {
			if (error instanceof GitError && error.kind === 'git') {
				const detail = error.detail ?? error.message;
				if (isBranchCollision(detail)) throw GitError.branchExists(branchName);
				if (detail.includes('locked') || detail.includes('in use')) {
					throw GitError.worktreeBusy(detail);
				}
			}
			throw error;
		}
	});
	await populateCheckout(basePath, worktreePath);
}

async function advanceBaseCheckout(basePath: string): Promise<void> {
	let upstream: string;
	try {
		upstream = (
			await runGit(['-C', basePath, 'rev-parse', '--symbolic-full-name', '@{upstream}'])
		).trim();
	} catch {
		return;
	}
	const outcome = await fastForwardCheckout(basePath, upstream).catch((error: unknown) =>
		describeError(error),
	);
	if (outcome === 'current' || outcome === 'advanced') return;
	console.warn(
		`malini: could not fast-forward \`${basePath}\` to \`${upstream}\`, so new workstreams write the files it lacks: ${outcome}`,
	);
}

export async function populateCheckout(repository: string, checkout: string): Promise<void> {
	if (!(await lstat(join(checkout, '.git'))).isFile()) {
		throw GitError.unsafePath(`not a linked worktree: ${checkout}`);
	}
	await cloneTrackedEntries(repository, checkout);
	await runGit(['-C', checkout, 'read-tree', 'HEAD']);
	await runGit(['-C', checkout, 'clean', '-ffdxq']);
	await emptyClonedSubmodules(checkout);
	await runGit(['-C', checkout, 'update-index', '-q', '--refresh']);
	await runGit(['-C', checkout, 'reset', '-q', '--hard', 'HEAD']);
}

async function cloneTrackedEntries(repository: string, checkout: string): Promise<void> {
	const listed = await runGit(['-C', checkout, 'ls-tree', '-z', 'HEAD']);
	const sources = listed.split('\0').flatMap((entry) => {
		const tab = entry.indexOf('\t');
		if (tab === -1 || entry.startsWith('160000 ')) return [];
		const source = join(repository, entry.slice(tab + 1));
		return existsSync(source) ? [source] : [];
	});
	try {
		await cloneInto(sources, checkout);
	} catch (error) {
		console.warn(
			`malini: could not clone every file of \`${repository}\` into \`${checkout}\`; git writes the rest: ${describeError(error)}`,
		);
	}
}

async function emptyClonedSubmodules(checkout: string): Promise<void> {
	if (!existsSync(join(checkout, '.gitmodules'))) return;
	let listed: string;
	try {
		listed = await runGit([
			'-C',
			checkout,
			'config',
			'--file',
			'.gitmodules',
			'--null',
			'--get-regexp',
			'^submodule\\..*\\.path$',
		]);
	} catch {
		return;
	}
	const root = await realpath(checkout);
	for (const entry of listed.split('\0')) {
		const directory = await realpath(join(checkout, entry.slice(entry.indexOf('\n') + 1))).catch(
			() => null,
		);
		if (directory === null || !isInsideDirectory(root, directory)) continue;
		if (!existsSync(join(directory, '.git'))) continue;
		await rm(directory, { recursive: true, force: true });
		await mkdir(directory, { recursive: true });
	}
}

async function branchExists(basePath: string, branchName: string): Promise<boolean> {
	try {
		return (await branchList(basePath)).includes(branchName);
	} catch {
		return true;
	}
}

export async function addWorktreeWithRollback(
	basePath: string,
	worktreePath: string,
	branchName: string,
	baseBranch: string,
): Promise<void> {
	const worktreeExistedBeforeAdd = existsSync(worktreePath);
	const branchExistedBeforeAdd = await branchExists(basePath, branchName);
	try {
		await addWorktree(basePath, worktreePath, branchName, baseBranch);
	} catch (error) {
		if (error instanceof GitError && error.kind === 'branch-exists' && branchExistedBeforeAdd) {
			throw error;
		}
		const cleanup = await cleanupFailedWorktreeAdd(
			basePath,
			worktreePath,
			branchName,
			worktreeExistedBeforeAdd,
			branchExistedBeforeAdd,
		);
		if (cleanup !== null) {
			const original = error instanceof Error ? error.message : String(error);
			throw GitError.git(`${original}; and the partial checkout could not be removed: ${cleanup}`);
		}
		throw error;
	}
}

function classifyWorktreeRemoval(error: unknown, worktreePath: string): GitError {
	if (error instanceof GitError && error.kind === 'git') {
		const detail = error.detail ?? error.message;
		if (detail.includes('not a working tree')) {
			return GitError.unsafePath(`not a git worktree: ${worktreePath}`);
		}
		return error;
	}
	return error instanceof GitError ? error : GitError.fromNodeError(error);
}

export async function removeWorktree(worktreePath: string): Promise<void> {
	const expectedBranch = deriveBranchFromPath(worktreePath);
	if (!expectedBranch.startsWith(WORKSTREAM_BRANCH_PREFIX)) {
		throw GitError.unsafePath(
			`worktree path \`${worktreePath}\` does not encode a workstream branch`,
		);
	}
	try {
		await runGit(['-C', worktreePath, 'worktree', 'remove', '--force', worktreePath]);
	} catch (error) {
		throw classifyWorktreeRemoval(error, worktreePath);
	}
}

export async function removeWorktreeFromBase(
	basePath: string,
	worktreePath: string,
): Promise<void> {
	try {
		await runGit(['-C', basePath, 'worktree', 'remove', '--force', worktreePath]);
	} catch (error) {
		throw classifyWorktreeRemoval(error, worktreePath);
	}
}

export async function deleteWorkstreamBranch(basePath: string, branchName: string): Promise<void> {
	await withProjectLock(deriveProjectId(basePath), () =>
		runGit(['-C', basePath, 'branch', '-D', branchName]),
	);
}

export async function cleanupFailedWorktreeAdd(
	basePath: string,
	worktreePath: string,
	branchName: string,
	worktreeExistedBeforeAdd: boolean,
	branchExistedBeforeAdd: boolean,
): Promise<string | null> {
	const failures: string[] = [];
	if (!worktreeExistedBeforeAdd) {
		try {
			await removeWorktreeFromBase(basePath, worktreePath);
		} catch {}
		if (existsSync(worktreePath)) {
			const failure = await removeCheckoutDirResilient(worktreePath);
			if (failure !== null) failures.push(failure);
		}
	}
	if (!branchExistedBeforeAdd) {
		try {
			await deleteWorkstreamBranch(basePath, branchName);
		} catch (error) {
			let stillPresent = false;
			try {
				stillPresent = (await branchList(basePath)).includes(branchName);
			} catch {
				stillPresent = false;
			}
			if (stillPresent) {
				failures.push(
					`could not delete branch \`${branchName}\`: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}
	return failures.length === 0 ? null : failures.join('; ');
}

export function cleanupFailedWorkstream(
	basePath: string,
	worktreePath: string,
	branchName: string,
): Promise<string | null> {
	return cleanupFailedWorktreeAdd(basePath, worktreePath, branchName, false, false);
}

const CHECKOUT_REMOVAL_ATTEMPTS = 5;
const CHECKOUT_REMOVAL_RETRY_BACKOFF_MS = 50;
const CHECKOUT_REMOVAL_REPORTED_ENTRIES = 3;

export type RemoveDirectory = (path: string) => Promise<void>;

const removeDirectoryReal: RemoveDirectory = async (path) => {
	try {
		await execFileAsync('/bin/rm', ['-rf', '--', path]);
	} catch {
		await execFileAsync('/bin/chmod', ['-R', 'u+w', '--', path]);
		await execFileAsync('/bin/rm', ['-rf', '--', path]);
	}
};

export async function removeCheckoutDirResilient(
	path: string,
	remove: RemoveDirectory = removeDirectoryReal,
): Promise<string | null> {
	let lastError: Error | null = null;
	for (let attempt = 1; attempt <= CHECKOUT_REMOVAL_ATTEMPTS; attempt += 1) {
		try {
			await remove(path);
			return null;
		} catch (error) {
			if (isErrnoException(error) && error.code === 'ENOENT') return null;
			lastError = error instanceof Error ? error : new Error(String(error));
			if (attempt < CHECKOUT_REMOVAL_ATTEMPTS) {
				await sleep(CHECKOUT_REMOVAL_RETRY_BACKOFF_MS * attempt);
			}
		}
	}
	if (!existsSync(path)) return null;
	return describeUnremovableCheckout(path, lastError);
}

function describeUnremovableCheckout(path: string, error: Error | null): string {
	let message = `could not empty \`${path}\` after ${CHECKOUT_REMOVAL_ATTEMPTS} attempts`;
	if (error) message += ` (${error.message})`;
	const { sample, hidden } = remainingEntrySample(path);
	if (sample.length > 0) {
		message += `; still present: ${sample.join(', ')}`;
		if (hidden > 0) message += ` (+${hidden} more)`;
	}
	message += '. Stop anything still writing inside the workstream and try again.';
	return message;
}

function remainingEntrySample(path: string): { sample: string[]; hidden: number } {
	let names: string[];
	try {
		names = readdirSync(path).sort();
	} catch {
		return { sample: [], hidden: 0 };
	}
	const total = names.length;
	return {
		sample: names.slice(0, CHECKOUT_REMOVAL_REPORTED_ENTRIES),
		hidden: Math.max(0, total - CHECKOUT_REMOVAL_REPORTED_ENTRIES),
	};
}

export async function owningRepositoryOfCheckout(checkout: string): Promise<string | null> {
	let commonDir: string;
	try {
		commonDir = (
			await runGit(['-C', checkout, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
		).trim();
	} catch {
		return null;
	}
	if (commonDir.length === 0) return null;
	return basename(commonDir) === '.git' ? dirname(commonDir) : commonDir;
}

export async function pruneWorktreeAdministration(repository: string): Promise<void> {
	try {
		await withProjectLock(deriveProjectId(repository), () =>
			runGit(['-C', repository, 'worktree', 'prune']),
		);
	} catch {}
}
