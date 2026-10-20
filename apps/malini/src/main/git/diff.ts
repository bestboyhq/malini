import { copyFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { ensureStagingPrecondition } from './excludes';
import {
	APP_MANAGED_EXCLUDE_PATHSPECS,
	isAppManagedGitPath,
	REPORTING_PATHSPECS,
	validateBaseBranch,
	WORKTREE_CONTENT_PATHSPEC,
} from './paths';
import { GitError } from '$main/errors';
import { runGit, runGitBoundedStdout, type GitEnv } from './run';
import type {
	WorkstreamFileEntry,
	WorkstreamSnapshot,
	WorktreeChangeTotals,
} from '../../contract/repositories';

export type { WorkstreamFileEntry, WorkstreamSnapshot, WorktreeChangeTotals };

export interface SnapshotChangedFile {
	path: string;
	additions: number;
	deletions: number;
	isBinary: boolean;
}

let temporaryIndexSequence = 0;

export class TemporaryGitIndex {
	readonly path: string;

	constructor() {
		temporaryIndexSequence += 1;
		this.path = join(
			tmpdir(),
			`malini-workstream-snapshot-${process.pid}-${temporaryIndexSequence}.index`,
		);
	}

	env(): GitEnv {
		return { GIT_INDEX_FILE: this.path };
	}

	async dispose(): Promise<void> {
		await rm(this.path, { force: true });
		await rm(`${this.path}.lock`, { force: true });
	}
}

export async function withTemporaryIndex<T>(
	body: (index: TemporaryGitIndex) => Promise<T>,
): Promise<T> {
	const index = new TemporaryGitIndex();
	try {
		return await body(index);
	} finally {
		await index.dispose();
	}
}

const VANISHED_FILE_RETRIES = 2;
const VANISHED_FILE_SETTLE_MS = 100;
const GIT_FATAL_EXIT_CODE = 128;
const VANISHED_WORKTREE_FILE =
	/(?:\bstat|unable to index file) '(?!\/)[^']+'(?:: No such file or directory)?|open\("(?!\/)[^"]+"\): No such file or directory/u;

export async function retryingVanishedFileRace<T>(read: () => Promise<T>): Promise<T> {
	for (let attempt = 0; ; attempt += 1) {
		try {
			return await read();
		} catch (error) {
			if (attempt >= VANISHED_FILE_RETRIES || !isVanishedFileRace(error)) throw error;
			await new Promise((resolve) => setTimeout(resolve, VANISHED_FILE_SETTLE_MS * (attempt + 1)));
		}
	}
}

function isVanishedFileRace(error: unknown): boolean {
	if (!(error instanceof GitError) || error.exitCode !== GIT_FATAL_EXIT_CODE) return false;
	const stderr = error.detail ?? '';
	return /No such file or directory/u.test(stderr) && VANISHED_WORKTREE_FILE.test(stderr);
}

const MAX_EXPANDED_UNTRACKED_LISTING_BYTES = 128 * 1024;

function untrackedListing(worktreePath: string): string[] {
	return ['-C', worktreePath, 'ls-files', '--others', '--exclude-standard'];
}

async function untrackedListingOverflows(
	worktreePath: string,
	pathspecs: readonly string[],
): Promise<boolean> {
	try {
		await runGitBoundedStdout(
			[...untrackedListing(worktreePath), '--', ...pathspecs],
			MAX_EXPANDED_UNTRACKED_LISTING_BYTES,
			'untracked file listing',
		);
		return false;
	} catch (error) {
		return error instanceof GitError && error.kind === 'output-too-large';
	}
}

export async function oversizedUntrackedDirectories(worktreePath: string): Promise<string[]> {
	if (!(await untrackedListingOverflows(worktreePath, REPORTING_PATHSPECS))) return [];
	const collapsed = await runGit([
		...untrackedListing(worktreePath),
		'--directory',
		'--no-empty-directory',
		'-z',
		'--',
		...REPORTING_PATHSPECS,
	]);
	const oversized: string[] = [];
	for (const directory of collapsed.split('\0').filter((entry) => entry.endsWith('/'))) {
		const scope = [`:(top,literal)${directory}`, ...APP_MANAGED_EXCLUDE_PATHSPECS];
		if (await untrackedListingOverflows(worktreePath, scope)) oversized.push(directory);
	}
	return oversized;
}

export function excludingDirectories(directories: readonly string[]): string[] {
	return directories.map((directory) => `:(exclude,top,literal)${directory}`);
}

async function worktreeContentPathspecs(worktreePath: string): Promise<string[]> {
	return [
		WORKTREE_CONTENT_PATHSPEC,
		...excludingDirectories(await oversizedUntrackedDirectories(worktreePath)),
	];
}

export async function diffCollector(worktreePath: string, path: string): Promise<string> {
	if (path.includes('..') || path.startsWith('/')) {
		throw GitError.unsafePath(`diff path \`${path}\` rejected by delete-guard`);
	}
	if (isAppManagedGitPath(path)) return '';
	return runGit(['-C', worktreePath, 'diff', '--', path]);
}

async function isFile(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

export async function diffAll(worktreePath: string): Promise<string> {
	await ensureStagingPrecondition(worktreePath);
	return retryingVanishedFileRace(() => diffAgainstIndex(worktreePath));
}

function diffAgainstIndex(worktreePath: string): Promise<string> {
	return withTemporaryIndex(async (index) => {
		const env = index.env();
		const reported = (
			await runGit(['-C', worktreePath, 'rev-parse', '--git-path', 'index'])
		).trim();
		if (reported.length === 0) {
			throw GitError.git('git returned an empty path for the worktree index');
		}
		const realIndex = isAbsolute(reported) ? reported : join(worktreePath, reported);
		if (await isFile(realIndex)) {
			await copyFile(realIndex, index.path);
		} else {
			await runGit(['-C', worktreePath, 'read-tree', '--empty'], env);
		}
		await runGit(
			['-C', worktreePath, 'add', '-N', '--', ...(await worktreeContentPathspecs(worktreePath))],
			env,
		);
		return runGit(
			[
				'-C',
				worktreePath,
				'diff',
				'--no-color',
				'--no-ext-diff',
				'--src-prefix=a/',
				'--dst-prefix=b/',
				'--',
				...REPORTING_PATHSPECS,
			],
			env,
		);
	});
}

export async function resolveBaseCommit(worktreePath: string, baseBranch: string): Promise<string> {
	validateBaseBranch(baseBranch);
	const candidates = baseBranch.startsWith('refs/')
		? [baseBranch]
		: baseBranch.startsWith('origin/')
			? [`refs/remotes/${baseBranch}`, `refs/heads/${baseBranch}`]
			: [`refs/remotes/origin/${baseBranch}`, `refs/heads/${baseBranch}`];
	let lastError: unknown = null;
	for (const candidate of candidates) {
		try {
			return (
				await runGit(['-C', worktreePath, 'rev-parse', '--verify', `${candidate}^{commit}`])
			).trim();
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError ?? GitError.git(`base branch \`${baseBranch}\` does not resolve to a commit`);
}

function parseCount(raw: string, describe: () => string): number {
	if (raw === '-') return 0;
	if (!/^\d+$/.test(raw)) throw GitError.git(describe());
	const value = Number(raw);
	if (!Number.isSafeInteger(value)) throw GitError.git(describe());
	return value;
}

export function parseNumstatTotals(output: string): WorktreeChangeTotals {
	let additions = 0;
	let deletions = 0;
	let files = 0;
	for (const line of output.split('\n')) {
		if (line.trim().length === 0) continue;
		files += 1;
		const fields = line.split('\t');
		const added = fields[0] ?? '';
		if (fields.length < 2) {
			throw GitError.git(`invalid git numstat row without deletions: \`${line}\``);
		}
		if (fields.length < 3) {
			throw GitError.git(`invalid git numstat row without a path: \`${line}\``);
		}
		const deleted = fields[1] ?? '';
		additions += parseCount(added, () => `invalid git numstat additions in row: \`${line}\``);
		deletions += parseCount(deleted, () => `invalid git numstat deletions in row: \`${line}\``);
		if (!Number.isSafeInteger(additions)) {
			throw GitError.git('git numstat additions exceeded supported range');
		}
		if (!Number.isSafeInteger(deletions)) {
			throw GitError.git('git numstat deletions exceeded supported range');
		}
	}
	return { additions, deletions, files };
}

export function parseSnapshotNumstat(output: string): SnapshotChangedFile[] {
	const files: SnapshotChangedFile[] = [];
	const seen = new Set<string>();
	for (const record of output.split('\0')) {
		if (record.length === 0) continue;
		const fields = record.split('\t');
		const additions = fields[0];
		const deletions = fields[1];
		const path = fields.slice(2).join('\t');
		if (additions === undefined) {
			throw GitError.git(`invalid snapshot numstat row without additions: \`${record}\``);
		}
		if (deletions === undefined) {
			throw GitError.git(`invalid snapshot numstat row without deletions: \`${record}\``);
		}
		if (fields.length < 3) {
			throw GitError.git(`invalid snapshot numstat row without a path: \`${record}\``);
		}
		if (path.length === 0 || seen.has(path)) {
			throw GitError.git(`snapshot numstat contains an empty or duplicate path: \`${path}\``);
		}
		seen.add(path);
		const isBinary = additions === '-' && deletions === '-';
		if (!isBinary && (additions === '-' || deletions === '-')) {
			throw GitError.git(`snapshot numstat has inconsistent binary counts for \`${path}\``);
		}
		files.push({
			path,
			additions: isBinary
				? 0
				: parseCount(
						additions,
						() => `invalid snapshot additions \`${additions}\` for \`${path}\``,
					),
			deletions: isBinary
				? 0
				: parseCount(
						deletions,
						() => `invalid snapshot deletions \`${deletions}\` for \`${path}\``,
					),
			isBinary,
		});
	}
	files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
	return files;
}

class MergeBaseWorktreeSnapshot {
	private constructor(
		private readonly worktree: string,
		private readonly mergeBase: string,
		private readonly index: TemporaryGitIndex,
		private readonly untrackedDirectories: readonly string[],
	) {}

	static async capture(
		worktreePath: string,
		baseBranch: string,
		index: TemporaryGitIndex,
	): Promise<MergeBaseWorktreeSnapshot> {
		await ensureStagingPrecondition(worktreePath);
		const baseCommit = await resolveBaseCommit(worktreePath, baseBranch);
		const mergeBase = (await runGit(['-C', worktreePath, 'merge-base', 'HEAD', baseCommit])).trim();
		if (mergeBase.length === 0) {
			throw GitError.git(`HEAD has no merge base with \`${baseBranch}\``);
		}
		const untrackedDirectories = await oversizedUntrackedDirectories(worktreePath);
		const snapshot = new MergeBaseWorktreeSnapshot(
			worktreePath,
			mergeBase,
			index,
			untrackedDirectories,
		);
		const env = index.env();
		await runGit(['-C', worktreePath, 'read-tree', mergeBase], env);
		await runGit(
			[
				'-C',
				worktreePath,
				'add',
				'-A',
				'--',
				WORKTREE_CONTENT_PATHSPEC,
				...excludingDirectories(untrackedDirectories),
			],
			env,
		);
		return snapshot;
	}

	numstat(): Promise<string> {
		return runGit(
			[
				'-C',
				this.worktree,
				'diff',
				'--cached',
				'--no-color',
				'--no-ext-diff',
				'--numstat',
				'--no-renames',
				this.mergeBase,
				'--',
				...REPORTING_PATHSPECS,
			],
			this.index.env(),
		);
	}

	unifiedDiff(): Promise<string> {
		return runGit(
			[
				'-C',
				this.worktree,
				'diff',
				'--cached',
				'--no-color',
				'--no-ext-diff',
				'--src-prefix=a/',
				'--dst-prefix=b/',
				'--no-renames',
				this.mergeBase,
				'--',
				...REPORTING_PATHSPECS,
			],
			this.index.env(),
		);
	}

	async totals(): Promise<WorktreeChangeTotals> {
		const totals = parseNumstatTotals(await this.numstat());
		return { ...totals, files: totals.files + this.untrackedDirectories.length };
	}

	async snapshot(): Promise<WorkstreamSnapshot> {
		const totals = await this.totals();
		const patch = await this.unifiedDiff();
		return { patch, totals };
	}
}

export function workstreamChangeTotals(
	worktreePath: string,
	baseBranch: string,
): Promise<WorktreeChangeTotals> {
	return readMergeBaseSnapshot(worktreePath, baseBranch, (snapshot) => snapshot.totals());
}

export function workstreamDiff(worktreePath: string, baseBranch: string): Promise<string> {
	return readMergeBaseSnapshot(worktreePath, baseBranch, (snapshot) => snapshot.unifiedDiff());
}

export function workstreamSnapshot(
	worktreePath: string,
	baseBranch: string,
): Promise<WorkstreamSnapshot> {
	return readMergeBaseSnapshot(worktreePath, baseBranch, (snapshot) => snapshot.snapshot());
}

function readMergeBaseSnapshot<T>(
	worktreePath: string,
	baseBranch: string,
	read: (snapshot: MergeBaseWorktreeSnapshot) => Promise<T>,
): Promise<T> {
	return retryingVanishedFileRace(() =>
		withTemporaryIndex(async (index) =>
			read(await MergeBaseWorktreeSnapshot.capture(worktreePath, baseBranch, index)),
		),
	);
}

export async function listWorkstreamFiles(worktreePath: string): Promise<WorkstreamFileEntry[]> {
	const output = await runGit([
		'-C',
		worktreePath,
		'ls-files',
		'--cached',
		'--others',
		'--exclude-standard',
		'-z',
		'--',
		...REPORTING_PATHSPECS,
	]);
	const entries = output
		.split('\0')
		.map((path) => path.trim())
		.filter((path) => path.length > 0)
		.map((path) => ({ path }));
	entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
	return entries;
}
