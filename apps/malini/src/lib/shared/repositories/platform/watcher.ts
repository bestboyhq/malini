import { watch, type FSWatcher } from 'node:fs';
import { join, resolve } from 'node:path';
import type { MaliniDatabase } from '$main/db/driver';
import { listWorkstreams } from './workstreams.repository';
import type { EventBus } from '$main/events';
import { SKIPPED_DIRECTORIES } from '$main/fs/paths';
import { isAppManagedGitPath } from '$main/git/paths';
import { runGit } from '$main/git/run';
import {
	REPOSITORIES_WORKSTREAM_CREATED_CHANNEL,
	REPOSITORIES_WORKSTREAM_FILES_CHANGED_CHANNEL,
	REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL,
	type WorkstreamFilesChangedPayload,
} from '$contract/events';

export type { WorkstreamFilesChangedPayload };

export const DEFAULT_FILES_CHANGED_DEBOUNCE_MS = 250;
export const DEFAULT_FILES_CHANGED_MAX_WAIT_MS = 2_000;

const GIT_DIR_HEADS: ReadonlySet<string> = new Set(['HEAD', 'ORIG_HEAD', 'MERGE_HEAD']);

export interface WorkstreamWatchersDeps {
	readonly db: MaliniDatabase;
	readonly events: EventBus;
	resolveWorktree(workstreamId: string): Promise<string>;
	readonly debounceMs?: number;
	readonly maxWaitMs?: number;
	readonly log?: (line: string) => void;
}

export interface WorkstreamWatchers {
	start(): Promise<void>;
	watch(workstreamId: string): Promise<void>;
	unwatch(workstreamId: string): void;
	isWatching(workstreamId: string): boolean;
	dispose(): void;
}

interface WatcherSet {
	readonly workstreamId: string;
	readonly watchers: FSWatcher[];
	timer: NodeJS.Timeout | null;
	burstStartedAt: number | null;
	closing: boolean;
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

function firstSegment(relativePath: string): string {
	return relativePath.split(/[\\/]/u)[0] ?? relativePath;
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

	const flush = (set: WatcherSet): void => {
		set.timer = null;
		set.burstStartedAt = null;
		const payload: WorkstreamFilesChangedPayload = {
			workstreamId: set.workstreamId,
			changedAt: new Date().toISOString(),
		};
		deps.events.emit(REPOSITORIES_WORKSTREAM_FILES_CHANGED_CHANNEL, payload);
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
	): void => {
		const watcher = watch(path, { recursive, persistent: false }, (_eventType, filename) => {
			if (accept(fileName(filename))) schedule(set);
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
			closing: false,
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
		} catch (error) {
			if (set.closing) return;
			log(
				`malini: watching workstream \`${workstreamId}\` without its git dir: ${describe(error)}`,
			);
		}
		if (set.closing) return;
		try {
			attach(set, worktreePath, true, (name) => {
				if (name === null) return true;
				return !SKIPPED_DIRECTORIES.has(firstSegment(name)) && !isAppManagedGitPath(name);
			});
			if (git) {
				attach(set, git.gitDir, false, (name) => name !== null && GIT_DIR_HEADS.has(name));
				attach(set, join(git.commonDir, 'refs'), true, (name) => !name?.endsWith('.lock'));
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
		dispose() {
			for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
			for (const set of [...sets.values()]) close(set);
		},
	};
}
