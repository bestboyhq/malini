import { basename } from 'node:path';
import { GitError } from '$main/errors';
import { runGit, runGitAllowingExit, runGitWithInput } from './run';

export const MAX_OVERLAP_PATHS = 100;

export type BaseOverlap = Readonly<{
	behind: number;
	conflictedPaths: readonly string[];
	overlappingPaths: readonly string[];
}>;

const LOCKFILES: ReadonlySet<string> = new Set([
	'bun.lock',
	'bun.lockb',
	'Cargo.lock',
	'composer.lock',
	'flake.lock',
	'Gemfile.lock',
	'go.sum',
	'mix.lock',
	'npm-shrinkwrap.json',
	'package-lock.json',
	'Package.resolved',
	'Pipfile.lock',
	'pnpm-lock.yaml',
	'Podfile.lock',
	'poetry.lock',
	'pubspec.lock',
	'uv.lock',
	'yarn.lock',
]);
const CHANGELOG = /^(?:changelog|changes)(?:\.[a-z]+)?$/iu;
const TREE_LINE = /^[0-9a-f]+[\n\0]/u;
const GENERATED = new Set(['set', 'true']);

export function changesWithEveryCommit(path: string): boolean {
	const name = basename(path);
	return LOCKFILES.has(name) || CHANGELOG.test(name);
}

export async function commitOf(worktreePath: string, ref: string): Promise<string | null> {
	try {
		const sha = await runGit([
			'-C',
			worktreePath,
			'rev-parse',
			'-q',
			'--verify',
			`${ref}^{commit}`,
		]);
		return sha.trim() || null;
	} catch (error) {
		if (error instanceof GitError && error.exitCode === 1) return null;
		throw error;
	}
}

export async function baseOverlap(
	worktreePath: string,
	head: string,
	baseHead: string,
): Promise<BaseOverlap | null> {
	const forkPoint = await mergeBase(worktreePath, head, baseHead);
	if (forkPoint === null || forkPoint === head || forkPoint === baseHead) return null;
	const [mine, theirs, conflictedPaths] = await Promise.all([
		changedPaths(worktreePath, forkPoint, head),
		changedPaths(worktreePath, forkPoint, baseHead),
		mergeConflicts(worktreePath, head, baseHead),
	]);
	const changedOnBase = new Set(theirs);
	const conflicted = new Set(conflictedPaths);
	const changedOnBoth = mine.filter(
		(path) => changedOnBase.has(path) && !conflicted.has(path) && !changesWithEveryCommit(path),
	);
	const generated = await generatedPaths(worktreePath, changedOnBoth);
	const overlappingPaths = [
		...conflictedPaths,
		...changedOnBoth.filter((path) => !generated.has(path)),
	];
	if (overlappingPaths.length === 0) return null;
	const behind = await runGit(['-C', worktreePath, 'rev-list', '--count', `${head}..${baseHead}`]);
	return {
		behind: Number(behind.trim()),
		conflictedPaths: conflictedPaths.slice(0, MAX_OVERLAP_PATHS),
		overlappingPaths: overlappingPaths.slice(0, MAX_OVERLAP_PATHS),
	};
}

async function mergeBase(
	worktreePath: string,
	head: string,
	baseHead: string,
): Promise<string | null> {
	const { allowed, stdout } = await runGitAllowingExit(
		['-C', worktreePath, 'merge-base', head, baseHead],
		1,
	);
	return allowed ? null : stdout.trim() || null;
}

async function changedPaths(worktreePath: string, from: string, to: string): Promise<string[]> {
	const output = await runGit([
		'-C',
		worktreePath,
		'diff',
		'--name-only',
		'--no-renames',
		'-z',
		from,
		to,
	]);
	return nulSeparated(output);
}

async function mergeConflicts(
	worktreePath: string,
	head: string,
	baseHead: string,
): Promise<string[]> {
	const { allowed, stdout } = await runGitAllowingExit(
		[
			'-C',
			worktreePath,
			'merge-tree',
			'--write-tree',
			'--name-only',
			'--no-messages',
			'-z',
			head,
			baseHead,
		],
		1,
	);
	return allowed ? [...new Set(nulSeparated(stdout.replace(TREE_LINE, '')))] : [];
}

async function generatedPaths(
	worktreePath: string,
	paths: readonly string[],
): Promise<ReadonlySet<string>> {
	if (paths.length === 0) return new Set();
	const output = await runGitWithInput(
		['-C', worktreePath, 'check-attr', '-z', '--stdin', 'linguist-generated'],
		paths.map((path) => `${path}\0`).join(''),
	);
	const fields = output.split('\0');
	const generated = new Set<string>();
	for (let index = 0; index + 2 < fields.length; index += 3) {
		const path = fields[index];
		if (path !== undefined && GENERATED.has(fields[index + 2] ?? '')) generated.add(path);
	}
	return generated;
}

function nulSeparated(output: string): string[] {
	return output.split('\0').filter((path) => path.length > 0);
}
