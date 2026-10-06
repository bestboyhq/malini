import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, normalize } from 'node:path';
import {
	parseSnapshotNumstat,
	retryingVanishedFileRace,
	withTemporaryIndex,
	type SnapshotChangedFile,
} from './diff';
import { ensureStagingPrecondition } from './excludes';
import { isAppManagedGitPath, REPORTING_PATHSPECS, WORKTREE_CONTENT_PATHSPEC } from './paths';
import { GitError } from '$main/errors';
import { runGit, runGitBoundedStdout, runGitWithInput, type GitEnv } from './run';
import { statusCollector } from './status';

export const MAX_RUN_CHANGE_PATCH_BYTES = 2 * 1024 * 1024;
const MAX_RUN_CHANGE_NUMSTAT_BYTES = 16 * 1024 * 1024;
const MAX_RUN_INTERVAL_RAW_BYTES = 64 * 1024 * 1024;

export const SNAPSHOT_REF_ROOT = 'refs/malini/';
export const LEGACY_SNAPSHOT_REF_ROOTS = ['refs/smack/', 'refs/core/'] as const;
export const CHECKPOINT_REF_NAMESPACE = `${SNAPSHOT_REF_ROOT}checkpoints/`;
export const RUN_CHANGE_REF_NAMESPACE = `${SNAPSHOT_REF_ROOT}run-changes/`;
export const USER_BASELINE_REF_NAMESPACE = `${SNAPSHOT_REF_ROOT}user-baselines/`;
export const SALVAGE_REF_NAMESPACE = `${SNAPSHOT_REF_ROOT}salvage/`;

function validatePrivateSnapshotRef(refName: string, namespace: string): void {
	if (!refName.startsWith(namespace) || refName.includes('..') || /\s/.test(refName)) {
		throw GitError.unsafePath(
			`snapshot ref \`${refName}\` is outside the private \`${namespace}\` namespace`,
		);
	}
}

export function salvageRefName(workstreamId: string): string {
	return `${SALVAGE_REF_NAMESPACE}${workstreamId}`;
}

export function undoSalvageRefName(workstreamId: string, restoreId: string): string {
	return `${SALVAGE_REF_NAMESPACE}${workstreamId}.undo.${restoreId}`;
}

export interface SnapshotIdentity {
	name: string;
	email: string;
}

export const CHECKPOINT_IDENTITY: SnapshotIdentity = {
	name: 'malini checkpoint',
	email: 'checkpoint@malini.local',
};

export const USER_BASELINE_IDENTITY: SnapshotIdentity = {
	name: 'malini user baseline',
	email: 'user-baseline@malini.local',
};

export interface SnapshotDiff {
	files: SnapshotChangedFile[];
}

export interface SessionRunSnapshot {
	runId: string;
	beforeCommit: string;
	afterCommit: string;
	files: readonly SnapshotChangedFile[];
}

export interface ComposedSessionSnapshot {
	beforeTree: string;
	afterTree: string;
	files: SnapshotChangedFile[];
	runIdsByPath: Map<string, string[]>;
	stackedPaths: Set<string>;
}

function identityEnv(identity: SnapshotIdentity): GitEnv {
	return {
		GIT_AUTHOR_NAME: identity.name,
		GIT_AUTHOR_EMAIL: identity.email,
		GIT_COMMITTER_NAME: identity.name,
		GIT_COMMITTER_EMAIL: identity.email,
	};
}

async function withSnapshotIndex<T>(
	worktreePath: string,
	identity: SnapshotIdentity,
	body: (env: GitEnv) => Promise<T>,
): Promise<T> {
	await ensureStagingPrecondition(worktreePath);
	return withTemporaryIndex((index) => body({ ...index.env(), ...identityEnv(identity) }));
}

async function headCommit(worktree: string): Promise<string | null> {
	try {
		return (await runGit(['-C', worktree, 'rev-parse', '--verify', '-q', 'HEAD^{commit}'])).trim();
	} catch {
		return null;
	}
}

function stageWorktreeContent(worktree: string, env: GitEnv, head: string | null): Promise<string> {
	return retryingVanishedFileRace(async () => {
		await runGit(['-C', worktree, 'read-tree', head ?? '--empty'], env);
		await runGit(['-C', worktree, 'add', '-A', '--', WORKTREE_CONTENT_PATHSPEC], env);
		return (await runGit(['-C', worktree, 'write-tree'], env)).trim();
	});
}

async function createPrivateWorktreeSnapshot(
	worktreePath: string,
	refName: string,
	snapshotId: string,
	messagePrefix: string,
	identity: SnapshotIdentity,
): Promise<string> {
	return withSnapshotIndex(worktreePath, identity, async (env) => {
		const head = await headCommit(worktreePath);
		const tree = await stageWorktreeContent(worktreePath, env, head);
		const parent = head === null ? [] : ['-p', head];
		const commit = (
			await runGit(
				[
					'-C',
					worktreePath,
					'commit-tree',
					tree,
					...parent,
					'-m',
					`${messagePrefix} ${snapshotId}`,
				],
				env,
			)
		).trim();
		await runGit(['-C', worktreePath, 'update-ref', refName, commit]);
		return commit;
	});
}

export async function createSalvageSnapshot(
	worktreePath: string,
	refName: string,
	workstreamId: string,
): Promise<string> {
	validatePrivateSnapshotRef(refName, SALVAGE_REF_NAMESPACE);
	return createPrivateWorktreeSnapshot(
		worktreePath,
		refName,
		workstreamId,
		'malini salvage',
		CHECKPOINT_IDENTITY,
	);
}

export async function checkoutHasUncommittedWork(worktreePath: string): Promise<boolean> {
	return (await statusCollector(worktreePath)).dirtyPaths.length > 0;
}

export async function createCheckpointSnapshot(
	worktreePath: string,
	refName: string,
	checkpointId: string,
): Promise<string> {
	validatePrivateSnapshotRef(refName, CHECKPOINT_REF_NAMESPACE);
	return createPrivateWorktreeSnapshot(
		worktreePath,
		refName,
		checkpointId,
		'malini checkpoint',
		CHECKPOINT_IDENTITY,
	);
}

export async function createRunChangeSnapshot(
	worktreePath: string,
	refName: string,
	snapshotId: string,
): Promise<string> {
	validatePrivateSnapshotRef(refName, RUN_CHANGE_REF_NAMESPACE);
	return createPrivateWorktreeSnapshot(
		worktreePath,
		refName,
		snapshotId,
		'malini run snapshot',
		CHECKPOINT_IDENTITY,
	);
}

export async function createUserBaselineSnapshot(
	worktreePath: string,
	refName: string,
	baselineId: string,
): Promise<string> {
	validatePrivateSnapshotRef(refName, USER_BASELINE_REF_NAMESPACE);
	return createPrivateWorktreeSnapshot(
		worktreePath,
		refName,
		baselineId,
		'malini user baseline',
		USER_BASELINE_IDENTITY,
	);
}

export async function worktreeSnapshotTree(worktreePath: string): Promise<string> {
	const head = await headCommit(worktreePath);
	return withSnapshotIndex(worktreePath, CHECKPOINT_IDENTITY, (env) =>
		stageWorktreeContent(worktreePath, env, head),
	);
}

export async function snapshotCommitTree(worktreePath: string, commit: string): Promise<string> {
	return (await runGit(['-C', worktreePath, 'rev-parse', `${commit}^{tree}`])).trim();
}

async function validateSnapshotCommits(
	worktree: string,
	beforeCommit: string,
	afterCommit: string,
): Promise<void> {
	for (const commit of [beforeCommit, afterCommit]) {
		await runGit(['-C', worktree, 'cat-file', '-e', `${commit}^{commit}`]);
	}
}

async function validateSnapshotTree(worktree: string, tree: string): Promise<void> {
	await runGit(['-C', worktree, 'cat-file', '-e', `${tree}^{tree}`]);
}

export function snapshotPatchPathspec(path: string): string {
	const segments = normalize(path).split(/[\\/]+/);
	const invalid =
		path.length === 0 ||
		isAbsolute(path) ||
		segments.some((segment) => segment === '' || segment === '.' || segment === '..');
	if (invalid) {
		throw GitError.unsafePath(
			`run-change diff path \`${path}\` must be a repository-relative file`,
		);
	}
	if (isAppManagedGitPath(path)) {
		throw GitError.unsafePath(`run-change diff path \`${path}\` is owned by the app`);
	}
	return `:(top,literal)${path}`;
}

function snapshotBinaryPatch(
	worktree: string,
	beforeCommit: string,
	afterCommit: string,
	path: string,
): Promise<string> {
	const pathspec = snapshotPatchPathspec(path);
	return runGitBoundedStdout(
		[
			'-C',
			worktree,
			'diff',
			'--binary',
			'--full-index',
			'--no-color',
			'--no-ext-diff',
			'--no-renames',
			beforeCommit,
			afterCommit,
			'--',
			pathspec,
		],
		MAX_RUN_CHANGE_PATCH_BYTES,
		'run-change composition patch',
	);
}

interface TreeEntry {
	mode: string;
	oid: string;
}

interface RunInterval {
	before: TreeEntry | null;
	after: TreeEntry | null;
}

interface PathComposition {
	before: TreeEntry | null;
	current: TreeEntry | null;
	runIds: string[];
	stacked: boolean;
	recorded: SnapshotChangedFile;
}

interface ComposedTrees {
	beforeTree: string;
	afterTree: string;
}

const ABSENT_MODE = '000000';

function sameEntry(left: TreeEntry | null, right: TreeEntry | null): boolean {
	if (left === null || right === null) return left === right;
	return left.mode === right.mode && left.oid === right.oid;
}

function treeEntry(mode: string, oid: string): TreeEntry | null {
	return mode === ABSENT_MODE ? null : { mode, oid };
}

async function runIntervals(
	worktree: string,
	beforeCommit: string,
	afterCommit: string,
): Promise<Map<string, RunInterval>> {
	const raw = await runGitBoundedStdout(
		[
			'-C',
			worktree,
			'diff',
			'--raw',
			'-z',
			'--no-abbrev',
			'--no-renames',
			'--no-ext-diff',
			beforeCommit,
			afterCommit,
			'--',
			...REPORTING_PATHSPECS,
		],
		MAX_RUN_INTERVAL_RAW_BYTES,
		'run-change interval inventory',
	);
	const intervals = new Map<string, RunInterval>();
	const fields = raw.split('\0');
	for (let index = 0; index + 1 < fields.length; index += 2) {
		const meta = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) [A-Z]/u.exec(fields[index] ?? '');
		const path = fields[index + 1];
		if (!meta || path === undefined || path.length === 0) {
			throw GitError.git(`invalid run-change interval row: \`${fields[index] ?? ''}\``);
		}
		intervals.set(path, {
			before: treeEntry(meta[1] ?? ABSENT_MODE, meta[3] ?? ''),
			after: treeEntry(meta[2] ?? ABSENT_MODE, meta[4] ?? ''),
		});
	}
	return intervals;
}

function indexInfo(entries: ReadonlyArray<readonly [string, TreeEntry | null]>): string {
	return entries
		.flatMap(([path, entry]) => (entry === null ? [] : [`${entry.mode} ${entry.oid}\t${path}\0`]))
		.join('');
}

async function writeSparseTree(
	worktree: string,
	entries: ReadonlyArray<readonly [string, TreeEntry | null]>,
): Promise<string> {
	return withTemporaryIndex(async (index) => {
		const env = index.env();
		await runGit(['-C', worktree, 'read-tree', '--empty'], env);
		await runGitWithInput(
			['-C', worktree, 'update-index', '-z', '--index-info'],
			indexInfo(entries),
			env,
		);
		return (await runGit(['-C', worktree, 'write-tree'], env)).trim();
	});
}

async function writeComposedTrees(
	worktree: string,
	composed: ReadonlyArray<readonly [string, PathComposition]>,
): Promise<ComposedTrees> {
	return {
		beforeTree: await writeSparseTree(
			worktree,
			composed.map(([path, state]) => [path, state.before] as const),
		),
		afterTree: await writeSparseTree(
			worktree,
			composed.map(([path, state]) => [path, state.current] as const),
		),
	};
}

async function diffComposedTrees(
	worktree: string,
	trees: ComposedTrees,
): Promise<SnapshotChangedFile[]> {
	const numstat = await runGitBoundedStdout(
		[
			'-C',
			worktree,
			'diff',
			'--numstat',
			'-z',
			'--no-color',
			'--no-ext-diff',
			'--no-renames',
			trees.beforeTree,
			trees.afterTree,
		],
		MAX_RUN_CHANGE_NUMSTAT_BYTES,
		'composed session-change file inventory',
	);
	return parseSnapshotNumstat(numstat);
}

async function rebaseIntervalOnto(
	worktree: string,
	patchDir: string,
	path: string,
	current: TreeEntry,
	run: SessionRunSnapshot,
): Promise<TreeEntry | null | undefined> {
	try {
		const patch = await snapshotBinaryPatch(worktree, run.beforeCommit, run.afterCommit, path);
		const patchPath = join(patchDir, 'interval.patch');
		await writeFile(patchPath, patch);
		return await withTemporaryIndex(async (index) => {
			const env = index.env();
			await runGitWithInput(
				['-C', worktree, 'update-index', '-z', '--index-info'],
				indexInfo([[path, current]]),
				env,
			);
			await runGit(
				['-C', worktree, 'apply', '--cached', '--3way', '--whitespace=nowarn', patchPath],
				env,
			);
			const listed = await runGit(
				['-C', worktree, 'ls-files', '-s', '-z', '--', snapshotPatchPathspec(path)],
				env,
			);
			const staged = listed
				.split('\0')
				.filter((record) => record.length > 0)
				.map((record) => /^(\d{6}) ([0-9a-f]+) (\d)\t/u.exec(record));
			if (staged.length === 0) return null;
			const [only] = staged;
			if (staged.length !== 1 || !only || only[3] !== '0') return undefined;
			return { mode: only[1] ?? '', oid: only[2] ?? '' };
		});
	} catch {
		return undefined;
	}
}

export async function composeSessionRunSnapshots(
	worktreePath: string,
	runs: readonly SessionRunSnapshot[],
): Promise<ComposedSessionSnapshot> {
	const paths = new Map<string, PathComposition>();
	const patchDir = await mkdtemp(join(tmpdir(), 'malini-run-patch-'));
	try {
		for (const run of runs) {
			if (run.files.length === 0) continue;
			const intervals = await runIntervals(worktreePath, run.beforeCommit, run.afterCommit);
			for (const file of run.files) {
				const { path } = file;
				const interval = intervals.get(path);
				const known = paths.get(path);
				if (!known) {
					paths.set(path, {
						before: interval?.before ?? null,
						current: interval?.after ?? null,
						runIds: [run.runId],
						stacked: interval === undefined,
						recorded: file,
					});
					continue;
				}
				known.runIds.push(run.runId);
				if (known.stacked) continue;
				if (interval === undefined) {
					known.stacked = true;
				} else if (sameEntry(known.current, interval.before)) {
					known.current = interval.after;
				} else if (!sameEntry(known.current, interval.after)) {
					const rebased =
						known.current === null
							? undefined
							: await rebaseIntervalOnto(worktreePath, patchDir, path, known.current, run);
					if (rebased === undefined) known.stacked = true;
					else known.current = rebased;
				}
			}
		}
	} finally {
		await rm(patchDir, { recursive: true, force: true });
	}
	const composed = [...paths].filter(([, state]) => !state.stacked);
	const trees = await writeComposedTrees(worktreePath, composed);
	const recomposed = composed.filter(([, state]) => state.runIds.length > 1);
	const recomposedFiles =
		recomposed.length === 0
			? []
			: await diffComposedTrees(
					worktreePath,
					recomposed.length === composed.length
						? trees
						: await writeComposedTrees(worktreePath, recomposed),
				);
	return {
		...trees,
		files: [
			...composed.flatMap(([, state]) => (state.runIds.length === 1 ? [state.recorded] : [])),
			...recomposedFiles,
		],
		runIdsByPath: new Map(
			[...paths]
				.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
				.map(([path, state]) => [path, state.runIds]),
		),
		stackedPaths: new Set([...paths].filter(([, state]) => state.stacked).map(([path]) => path)),
	};
}

export async function diffComposedSessionSnapshotPatch(
	worktreePath: string,
	beforeTree: string,
	afterTree: string,
	path: string,
): Promise<string> {
	await validateSnapshotTree(worktreePath, beforeTree);
	await validateSnapshotTree(worktreePath, afterTree);
	const pathspec = snapshotPatchPathspec(path);
	return runGitBoundedStdout(
		[
			'-C',
			worktreePath,
			'diff',
			'--src-prefix=a/',
			'--dst-prefix=b/',
			'--no-color',
			'--no-ext-diff',
			'--no-renames',
			beforeTree,
			afterTree,
			'--',
			pathspec,
		],
		MAX_RUN_CHANGE_PATCH_BYTES,
		'composed session-change patch',
	);
}

export async function diffWorktreeSnapshots(
	worktreePath: string,
	beforeCommit: string,
	afterCommit: string,
): Promise<SnapshotDiff> {
	await validateSnapshotCommits(worktreePath, beforeCommit, afterCommit);
	const numstat = await runGitBoundedStdout(
		[
			'-C',
			worktreePath,
			'diff',
			'--numstat',
			'-z',
			'--no-color',
			'--no-ext-diff',
			'--no-renames',
			beforeCommit,
			afterCommit,
			'--',
			...REPORTING_PATHSPECS,
		],
		MAX_RUN_CHANGE_NUMSTAT_BYTES,
		'run-change file inventory',
	);
	return { files: parseSnapshotNumstat(numstat) };
}

export async function diffWorktreeSnapshotPatch(
	worktreePath: string,
	beforeCommit: string,
	afterCommit: string,
	path: string | null,
): Promise<string> {
	await validateSnapshotCommits(worktreePath, beforeCommit, afterCommit);
	const pathspecs = path === null ? [...REPORTING_PATHSPECS] : [snapshotPatchPathspec(path)];
	return runGitBoundedStdout(
		[
			'-C',
			worktreePath,
			'diff',
			'--src-prefix=a/',
			'--dst-prefix=b/',
			'--no-color',
			'--no-ext-diff',
			'--no-renames',
			beforeCommit,
			afterCommit,
			'--',
			...pathspecs,
		],
		MAX_RUN_CHANGE_PATCH_BYTES,
		'run-change patch',
	);
}

export async function restoreCheckpointSnapshot(
	worktreePath: string,
	commit: string,
): Promise<void> {
	await runGit(['-C', worktreePath, 'cat-file', '-e', `${commit}^{commit}`]);
	await runGit(['-C', worktreePath, 'reset', '--hard', 'HEAD']);
	await runGit(['-C', worktreePath, 'clean', '-fd']);
	await runGit([
		'-C',
		worktreePath,
		'restore',
		'--source',
		commit,
		'--staged',
		'--worktree',
		'--',
		'.',
	]);
	await runGit(['-C', worktreePath, 'reset', '--mixed', 'HEAD']);
}

export async function pinSnapshotRef(
	worktreePath: string,
	refName: string,
	namespace: string,
	commit: string,
): Promise<void> {
	validatePrivateSnapshotRef(refName, namespace);
	await runGit(['-C', worktreePath, 'cat-file', '-e', `${commit}^{commit}`]);
	await runGit(['-C', worktreePath, 'update-ref', refName, commit]);
}

async function deletePrivateRef(
	worktreePath: string,
	refName: string,
	namespace: string,
): Promise<void> {
	validatePrivateSnapshotRef(refName, namespace);
	await runGit(['-C', worktreePath, 'update-ref', '-d', refName]);
}

export async function deleteCheckpointRef(worktreePath: string, refName: string): Promise<void> {
	return deletePrivateRef(worktreePath, refName, CHECKPOINT_REF_NAMESPACE);
}

export async function deleteRunChangeRef(worktreePath: string, refName: string): Promise<void> {
	return deletePrivateRef(worktreePath, refName, RUN_CHANGE_REF_NAMESPACE);
}

export async function deleteUserBaselineRef(worktreePath: string, refName: string): Promise<void> {
	return deletePrivateRef(worktreePath, refName, USER_BASELINE_REF_NAMESPACE);
}
