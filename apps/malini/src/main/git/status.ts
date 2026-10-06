import { existsSync, statSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { excludingDirectories, oversizedUntrackedDirectories } from './diff';
import { isAppManagedGitPath, REPORTING_PATHSPECS } from './paths';
import { runGit } from './run';
import type { WorktreeOperation, WorktreeStatus } from '../../contract/repositories';

export type { WorktreeStatus };

export function isConflictedStatusCode(code: string): boolean {
	if (code.length !== 2) return false;
	const x = code[0];
	const y = code[1];
	return x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D');
}

export function parseStatus(output: string): WorktreeStatus {
	let branch = '';
	let ahead = 0;
	let behind = 0;
	let hasUpstream = false;
	const dirtyPaths: string[] = [];
	const conflictedPaths: string[] = [];

	const records = output.split('\0');
	for (let index = 0; index < records.length; index += 1) {
		const line = records[index] ?? '';
		if (line.startsWith('## ')) {
			const stripped = line.slice(3);
			const separator = stripped.indexOf('...');
			hasUpstream = separator !== -1;
			const rawBranch = hasUpstream ? stripped.slice(0, separator) : stripped;
			const remainder = hasUpstream ? stripped.slice(separator + 3) : '';
			branch = rawBranch;
			const start = remainder.indexOf('[');
			const end = remainder.indexOf(']');
			if (start !== -1 && end !== -1 && end > start) {
				for (const token of remainder.slice(start + 1, end).split(',')) {
					const trimmed = token.trim();
					if (trimmed.startsWith('ahead ')) {
						ahead = Number.parseInt(trimmed.slice(6), 10) || 0;
					} else if (trimmed.startsWith('behind ')) {
						behind = Number.parseInt(trimmed.slice(7), 10) || 0;
					}
				}
			}
		} else if (line.length >= 4) {
			const code = line.slice(0, 2);
			const path = line.slice(3);
			if (/[RC]/u.test(code)) index += 1;
			if (!isAppManagedGitPath(path)) {
				if (isConflictedStatusCode(code)) conflictedPaths.push(path);
				dirtyPaths.push(path);
			}
		}
	}

	return {
		branch,
		dirtyPaths,
		conflictedPaths,
		conflictMarkerPaths: [],
		ahead,
		behind,
		hasUpstream,
		mergeInProgress: false,
		operationInProgress: null,
		headSha: null,
	};
}

export async function statusCollector(worktreePath: string): Promise<WorktreeStatus> {
	const oversized = await oversizedUntrackedDirectories(worktreePath);
	const output = await runGit([
		'-C',
		worktreePath,
		'status',
		'--porcelain',
		'--branch',
		'--untracked-files=all',
		'-z',
		'--',
		...REPORTING_PATHSPECS,
		...excludingDirectories(oversized),
	]);
	const status = parseStatus(output);
	status.dirtyPaths.push(...oversized);
	try {
		const head = (await runGit(['-C', worktreePath, 'rev-parse', '--verify', 'HEAD'])).trim();
		status.headSha = head.length > 0 ? head : null;
	} catch {
		status.headSha = null;
	}
	status.conflictMarkerPaths = await conflictMarkerPaths(worktreePath, status.conflictedPaths);
	const gitDir = await resolvedGitDir(worktreePath);
	const operation = gitDir === null ? null : operationIn(gitDir);
	status.operationInProgress = operation;
	status.mergeInProgress = operation !== null;
	if (operation === 'rebase' && gitDir !== null) {
		status.branch = (await rebasedBranch(gitDir)) ?? status.branch;
	}
	return status;
}

const CONFLICT_MARKER_LINE = /^(?:<{7}|>{7})(?: |\r?$)/mu;
const BINARY_SNIFF_BYTES = 8_000;

export async function conflictMarkerPaths(
	worktreePath: string,
	paths: readonly string[],
): Promise<string[]> {
	const marked = await Promise.all(
		paths.map(async (path) =>
			(await holdsConflictMarkers(join(worktreePath, path))) ? path : null,
		),
	);
	return marked.filter((path): path is string => path !== null);
}

async function holdsConflictMarkers(file: string): Promise<boolean> {
	try {
		if (!(await lstat(file)).isFile()) return false;
		const content = await readFile(file);
		if (content.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return false;
		return CONFLICT_MARKER_LINE.test(content.toString('utf8'));
	} catch {
		return false;
	}
}

export async function resolvedGitDir(worktreePath: string): Promise<string | null> {
	let reported: string;
	try {
		reported = (
			await runGit(['-C', worktreePath, 'rev-parse', '--path-format=absolute', '--git-dir'])
		).trim();
	} catch {
		return null;
	}
	if (reported.length === 0) return null;
	return isAbsolute(reported) ? reported : join(worktreePath, reported);
}

const REBASE_DIRS = ['rebase-merge', 'rebase-apply'];

export async function inProgressOperation(worktreePath: string): Promise<WorktreeOperation | null> {
	const gitDir = await resolvedGitDir(worktreePath);
	return gitDir === null ? null : operationIn(gitDir);
}

function operationIn(gitDir: string): WorktreeOperation | null {
	const rebasing =
		existsSync(join(gitDir, 'REBASE_HEAD')) ||
		REBASE_DIRS.some((name) => {
			try {
				return statSync(join(gitDir, name)).isDirectory();
			} catch {
				return false;
			}
		});
	if (rebasing) return 'rebase';
	if (existsSync(join(gitDir, 'MERGE_HEAD'))) return 'merge';
	if (existsSync(join(gitDir, 'CHERRY_PICK_HEAD'))) return 'cherry-pick';
	if (existsSync(join(gitDir, 'REVERT_HEAD'))) return 'revert';
	return null;
}

async function rebasedBranch(gitDir: string): Promise<string | null> {
	for (const name of REBASE_DIRS) {
		try {
			const ref = (await readFile(join(gitDir, name, 'head-name'), 'utf8')).trim();
			if (ref.startsWith('refs/heads/')) return ref.slice('refs/heads/'.length);
		} catch {
			continue;
		}
	}
	return null;
}
