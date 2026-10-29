import { watch, type FSWatcher } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { MaliniDatabase } from '$main/db/driver';
import { getWorkstream, listWorkstreams } from './workstreams.repository';
import { GitError } from '$main/errors';
import type { EventBus } from '$main/events';
import { SKIPPED_DIRECTORIES } from '$main/fs/paths';
import { isAppManagedGitPath } from '$main/git/paths';
import { runGit } from '$main/git/run';
import {
	REPOSITORIES_WORKSTREAM_CREATED_CHANNEL,
	REPOSITORIES_WORKSTREAM_FILES_CHANGED_CHANNEL,
	REPOSITORIES_WORKSTREAM_HEAD_MOVED_CHANNEL,
	REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL,
	REPOSITORIES_WORKSTREAM_PUSHED_CHANNEL,
	REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL,
	type WorkstreamFilesChangedPayload,
	type WorkstreamMergeConflictedPayload,
} from '$contract/events';

export type { WorkstreamFilesChangedPayload };

export const DEFAULT_FILES_CHANGED_DEBOUNCE_MS = 250;
export const DEFAULT_FILES_CHANGED_MAX_WAIT_MS = 2_000;
export const MAX_RECORDED_CHANGED_PATHS = 1_000;
const MAX_REMEMBERED_STAMPS = 10_000;

const GIT_DIR_HEADS: ReadonlySet<string> = new Set(['HEAD', 'ORIG_HEAD', 'MERGE_HEAD']);

export interface WorkstreamWatchersDeps {
	readonly db: MaliniDatabase;
	readonly events: EventBus;
	resolveWorktree(workstreamId: string): Promise<string>;
	readonly debounceMs?: number;
	readonly maxWaitMs?: number;
	readonly log?: (line: string) => void;
}

export type MergeConflict = WorkstreamMergeConflictedPayload & Readonly<{ mergeHead: string }>;

export interface WorkstreamWatchers {
	start(): Promise<void>;
	watch(workstreamId: string): Promise<void>;
	unwatch(workstreamId: string): void;
	isWatching(workstreamId: string): boolean;
	refresh(workstreamId: string): Promise<void>;
	reportMergeConflict(conflict: MergeConflict): void;
	dispose(): void;
}

interface GitFacts {
	readonly head: string | null;
	readonly branch: string | null;
	readonly remoteHead: string | null;
	readonly mergeHead: string | null;
}

interface WatcherSet {
	readonly workstreamId: string;
	readonly watchers: FSWatcher[];
	timer: NodeJS.Timeout | null;
	burstStartedAt: number | null;
	changedPaths: Set<string> | null;
	stamps: Map<string, string>;
	closing: boolean;
	worktreePath: string | null;
	facts: GitFacts | null;
	gitMoved: boolean;
	reading: Promise<void>;
}

interface GitDirectories {
	gitDir: string;
	commonDir: string;
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function fileName(filename: string | Buffer | null): string | null {
	if (filename === null) return null;
	return typeof filename === 'string' ? filename : filename.toString();
}

function workstreamIdOf(payload: unknown): string | null {
	if (typeof payload !== 'object' || payload === null) return null;
	const value = Reflect.get(payload, 'workstreamId');
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function recordChangedPath(paths: Set<string> | null, name: string | null): Set<string> | null {
	if (paths === null || name === null || paths.size >= MAX_RECORDED_CHANGED_PATHS) return null;
	return paths.add(name.split(sep).join('/'));
}

async function stampOf(path: string): Promise<string> {
	try {
		const { ino, size, mtimeMs, ctimeMs } = await lstat(path);
		return `${ino}:${size}:${mtimeMs}:${ctimeMs}`;
	} catch {
		return 'missing';
	}
}

function firstSegment(relativePath: string): string {
	return relativePath.split(/[\\/]/u)[0] ?? relativePath;
}

async function gitOrAbsent(worktreePath: string, args: readonly string[]): Promise<string | null> {
	try {
		return (await runGit(['-C', worktreePath, ...args])).trim() || null;
	} catch (error) {
		if (error instanceof GitError && error.exitCode === 1) return null;
		throw error;
	}
}

async function readGitFacts(worktreePath: string): Promise<GitFacts> {
	const [head, branch, mergeHead] = await Promise.all([
		gitOrAbsent(worktreePath, ['rev-parse', '-q', '--verify', 'HEAD']),
		gitOrAbsent(worktreePath, ['symbolic-ref', '-q', '--short', 'HEAD']),
		gitOrAbsent(worktreePath, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']),
	]);
	const remoteHead =
		branch === null
			? null
			: await gitOrAbsent(worktreePath, [
					'rev-parse',
					'-q',
					'--verify',
					`refs/remotes/origin/${branch}`,
				]);
	return { head, branch, remoteHead, mergeHead };
}

async function unmergedPaths(worktreePath: string): Promise<string[]> {
	const output = await runGit(['-C', worktreePath, 'diff', '--name-only', '--diff-filter=U', '-z']);
	return output.split('\0').filter((path) => path.length > 0 && !isAppManagedGitPath(path));
}

async function gitDirectories(worktreePath: string): Promise<GitDirectories> {
	const output = await runGit(['-C', worktreePath, 'rev-parse', '--git-dir', '--git-common-dir']);
	const [gitDir, commonDir] = output.split('\n').map((line) => line.trim());
	if (!gitDir || !commonDir) throw new Error('git rev-parse did not name both directories');
	return { gitDir: resolve(worktreePath, gitDir), commonDir: resolve(worktreePath, commonDir) };
}

export function createWorkstreamWatchers(deps: WorkstreamWatchersDeps): WorkstreamWatchers {
	const debounceMs = deps.debounceMs ?? DEFAULT_FILES_CHANGED_DEBOUNCE_MS;
	const maxWaitMs = deps.maxWaitMs ?? DEFAULT_FILES_CHANGED_MAX_WAIT_MS;
	const log = deps.log ?? ((line: string) => console.error(line));
	const sets = new Map<string, WatcherSet>();
	const unsubscribes: Array<() => void> = [];
	const reportedConflicts = new Map<string, string>();

	const reportMergeConflict = ({ mergeHead, ...conflict }: MergeConflict): void => {
		if (reportedConflicts.get(conflict.workstreamId) === mergeHead) return;
		reportedConflicts.set(conflict.workstreamId, mergeHead);
		deps.events.emit(REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL, conflict);
	};

	const reportFacts = async (set: WatcherSet): Promise<void> => {
		const { workstreamId, worktreePath, facts: previous } = set;
		if (set.closing || worktreePath === null || previous === null) return;
		const next = await readGitFacts(worktreePath);
		if (set.closing) return;
		set.facts = next;
		if (next.head !== null && next.head !== previous.head) {
			deps.events.emit(REPOSITORIES_WORKSTREAM_HEAD_MOVED_CHANNEL, {
				workstreamId,
				branch: next.branch,
				head: next.head,
				previousHead: previous.head,
			});
		}
		if (
			next.branch !== null &&
			next.branch === previous.branch &&
			next.remoteHead !== null &&
			next.remoteHead !== previous.remoteHead
		) {
			deps.events.emit(REPOSITORIES_WORKSTREAM_PUSHED_CHANNEL, {
				workstreamId,
				branch: next.branch,
				head: next.remoteHead,
			});
		}
		if (next.mergeHead === null) {
			reportedConflicts.delete(workstreamId);
			return;
		}
		if (reportedConflicts.get(workstreamId) === next.mergeHead) return;
		const conflictedPaths = await unmergedPaths(worktreePath);
		const baseBranch = getWorkstream(deps.db, workstreamId)?.baseBranch;
		if (set.closing || conflictedPaths.length === 0 || baseBranch === undefined) return;
		reportMergeConflict({ workstreamId, baseBranch, conflictedPaths, mergeHead: next.mergeHead });
	};

	const refreshAfter = async (set: WatcherSet, previous: Promise<void>): Promise<void> => {
		await previous;
		try {
			await reportFacts(set);
		} catch (error) {
			log(`malini: could not read git in workstream \`${set.workstreamId}\`: ${describe(error)}`);
		}
	};

	const refresh = async (workstreamId: string): Promise<void> => {
		const set = sets.get(workstreamId);
		if (!set || set.closing || set.worktreePath === null || set.facts === null) return;
		const reading = refreshAfter(set, set.reading);
		set.reading = reading;
		await reading;
	};

	const changedSinceLastReport = async (
		set: WatcherSet,
		recorded: ReadonlySet<string>,
	): Promise<string[]> => {
		const worktreePath = set.worktreePath;
		if (worktreePath === null) return [...recorded];
		const stamped = await Promise.all(
			[...recorded].map(async (path) => ({ path, stamp: await stampOf(join(worktreePath, path)) })),
		);
		// ponytail: forgets every stamp past the cap, so an echo right after that reports once more
		if (set.stamps.size > MAX_REMEMBERED_STAMPS) set.stamps.clear();
		const changed = stamped.filter(({ path, stamp }) => set.stamps.get(path) !== stamp);
		for (const { path, stamp } of changed) set.stamps.set(path, stamp);
		return changed.map(({ path }) => path);
	};

	const flush = (set: WatcherSet): void => {
		set.timer = null;
		set.burstStartedAt = null;
		const recorded = set.changedPaths;
		const gitMoved = set.gitMoved;
		set.changedPaths = new Set();
		set.gitMoved = false;
		set.reading = reportAfter(set, set.reading, recorded, gitMoved);
	};

	const reportAfter = async (
		set: WatcherSet,
		previous: Promise<void>,
		recorded: ReadonlySet<string> | null,
		gitMoved: boolean,
	): Promise<void> => {
		await previous;
		const paths = recorded && (await changedSinceLastReport(set, recorded));
		if (set.closing) return;
		if (paths === null || paths.length > 0 || recorded?.size === 0) {
			deps.events.emit(REPOSITORIES_WORKSTREAM_FILES_CHANGED_CHANNEL, {
				workstreamId: set.workstreamId,
				changedAt: new Date().toISOString(),
				paths,
			});
		}
		if (!gitMoved) return;
		try {
			await reportFacts(set);
		} catch (error) {
			log(`malini: could not read git in workstream \`${set.workstreamId}\`: ${describe(error)}`);
		}
	};

	const schedule = (set: WatcherSet): void => {
		if (set.closing) return;
		const now = Date.now();
		set.burstStartedAt ??= now;
		if (set.timer) clearTimeout(set.timer);
		const untilMaxWait = set.burstStartedAt + maxWaitMs - now;
		set.timer = setTimeout(() => flush(set), Math.max(0, Math.min(debounceMs, untilMaxWait)));
	};

	const close = (set: WatcherSet): void => {
		set.closing = true;
		if (set.timer) clearTimeout(set.timer);
		set.timer = null;
		for (const watcher of set.watchers.splice(0)) watcher.close();
		if (sets.get(set.workstreamId) === set) sets.delete(set.workstreamId);
	};

	const drop = (set: WatcherSet, reason: string): void => {
		if (set.closing) return;
		log(`malini: stopped watching workstream \`${set.workstreamId}\`: ${reason}`);
		close(set);
	};

	const attach = (
		set: WatcherSet,
		path: string,
		recursive: boolean,
		accept: (name: string | null) => boolean,
		watched: 'files' | 'git',
	): void => {
		const watcher = watch(path, { recursive, persistent: false }, (_eventType, filename) => {
			const name = fileName(filename);
			if (!accept(name)) return;
			if (watched === 'files') set.changedPaths = recordChangedPath(set.changedPaths, name);
			else set.gitMoved = true;
			schedule(set);
		});
		watcher.on('error', (error) => drop(set, describe(error)));
		watcher.on('close', () => drop(set, 'the watcher closed'));
		set.watchers.push(watcher);
	};

	const watchWorkstream = async (workstreamId: string): Promise<void> => {
		if (sets.has(workstreamId)) return;
		const set: WatcherSet = {
			workstreamId,
			watchers: [],
			timer: null,
			burstStartedAt: null,
			changedPaths: new Set(),
			stamps: new Map(),
			closing: false,
			worktreePath: null,
			facts: null,
			gitMoved: false,
			reading: Promise.resolve(),
		};
		sets.set(workstreamId, set);
		let worktreePath: string;
		try {
			worktreePath = await deps.resolveWorktree(workstreamId);
		} catch (error) {
			if (set.closing) return;
			sets.delete(workstreamId);
			log(`malini: not watching workstream \`${workstreamId}\`: ${describe(error)}`);
			return;
		}
		let git: GitDirectories | null = null;
		try {
			git = await gitDirectories(worktreePath);
			set.facts = await readGitFacts(worktreePath);
		} catch (error) {
			if (set.closing) return;
			log(
				`malini: watching workstream \`${workstreamId}\` without its git dir: ${describe(error)}`,
			);
		}
		if (set.closing) return;
		set.worktreePath = worktreePath;
		if (set.facts?.mergeHead) reportedConflicts.set(workstreamId, set.facts.mergeHead);
		try {
			attach(
				set,
				worktreePath,
				true,
				(name) => {
					if (name === null) return true;
					return !SKIPPED_DIRECTORIES.has(firstSegment(name)) && !isAppManagedGitPath(name);
				},
				'files',
			);
			if (git) {
				attach(set, git.gitDir, false, (name) => name !== null && GIT_DIR_HEADS.has(name), 'git');
				attach(set, join(git.commonDir, 'refs'), true, (name) => !name?.endsWith('.lock'), 'git');
			}
		} catch (error) {
			close(set);
			log(`malini: not watching workstream \`${workstreamId}\`: ${describe(error)}`);
		}
	};

	return {
		async start() {
			unsubscribes.push(
				deps.events.subscribe(REPOSITORIES_WORKSTREAM_CREATED_CHANNEL, (payload) => {
					const workstreamId = workstreamIdOf(payload);
					if (workstreamId !== null) void watchWorkstream(workstreamId);
				}),
				deps.events.subscribe(REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL, (payload) => {
					const workstreamId = workstreamIdOf(payload);
					const set = workstreamId === null ? undefined : sets.get(workstreamId);
					if (set) close(set);
				}),
			);
			const active = listWorkstreams(deps.db).filter((row) => row.status === 'active');
			await Promise.all(active.map((row) => watchWorkstream(row.id)));
		},
		watch: watchWorkstream,
		unwatch(workstreamId) {
			const set = sets.get(workstreamId);
			if (set) close(set);
		},
		isWatching: (workstreamId) => {
			const set = sets.get(workstreamId);
			return set !== undefined && set.watchers.length > 0;
		},
		refresh,
		reportMergeConflict,
		dispose() {
			for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
			for (const set of [...sets.values()]) close(set);
		},
	};
}
