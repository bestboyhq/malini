import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	PULL_REQUESTS_SHIP_CHANGED_CHANNEL,
	REPOSITORIES_WORKSTREAM_BASE_OVERLAPPED_CHANNEL,
	type WorkstreamBaseOverlappedPayload,
} from '$contract/events';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { createEventBus, type EventBus } from '$main/events';
import { initRealRepo, realGit, removeDir, tempDir } from '$main/git/fixtures.test-support';
import { fastForwardCheckout } from '$main/git/remote';
import { BaseOverlapWatch, type BaseOverlapWatchDeps } from './base-overlap.service';
import { upsertProject } from './projects.repository';
import { recordMergedPullRequest, upsertWorkstream } from './workstreams.repository';

const NOW = Date.parse('2026-11-01T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60_000;

let root: string;
let origin: string;
let base: string;
let worktree: string;
let db: MaliniDatabase;
let events: EventBus;
let busy: boolean;
let merging: boolean;
let ended: boolean;
let now: number;
let fetches: number;
let overlaps: WorkstreamBaseOverlappedPayload[];
let checkouts: Map<string, string>;
let watch: BaseOverlapWatch;

function watching(overrides: Partial<BaseOverlapWatchDeps> = {}): BaseOverlapWatch {
	return new BaseOverlapWatch({
		db,
		events,
		checkouts: {
			resolveCheckout: async (workstreamId) => checkouts.get(workstreamId) ?? worktree,
			resolveRepositoryRoot: async () => base,
		},
		fetchBase: async (repoPath, baseBranch) => {
			fetches += 1;
			await realGit(repoPath, ['fetch', '-q', 'origin', baseBranch]);
			return `refs/remotes/origin/${baseBranch}`;
		},
		busy: async () => busy,
		merging: async () => merging,
		pullRequestEnded: async () => ended,
		fastForward: (_workstreamId, checkout, baseRef) => fastForwardCheckout(checkout, baseRef),
		quietMs: 0,
		now: () => now,
		log: (line) => {
			throw new Error(line);
		},
		...overrides,
	});
}

async function workstreamAt(id: string, start: string): Promise<string> {
	const path = join(root, id);
	await realGit(base, ['worktree', 'add', '-q', '-b', `malini/${id}`, path, start]);
	upsertWorkstream(db, {
		id,
		projectId: 'p1',
		name: id,
		path,
		branch: `malini/${id}`,
		baseBranch: 'main',
		status: 'active',
		createdAt: '2026-10-31T00:00:00.000Z',
		startedBy: null,
	});
	checkouts.set(id, path);
	return path;
}

function workedIn(workstreamId: string, at: number): void {
	db.prepare(
		`INSERT INTO agent_sessions (id, workstream_id, model, status, started_at, display_name)
		 VALUES (?, ?, 'opus', 'completed', ?, 'Chat')`,
	).run(`session-${workstreamId}-${at}`, workstreamId, new Date(at).toISOString());
}

async function headOf(repo: string): Promise<string> {
	return (await realGit(repo, ['rev-parse', 'HEAD'])).trim();
}

beforeEach(async () => {
	root = await tempDir('malini-base-overlap-');
	origin = join(root, 'origin');
	base = join(root, 'base');
	worktree = join(root, 'ws');
	await initRealRepo(origin);
	await realGit(origin, ['branch', '-M', 'main']);
	await commit(origin, { 'shared.txt': 'shared\n', 'other.txt': 'other\n' });
	await realGit(root, ['clone', '-q', origin, base]);
	await realGit(base, ['worktree', 'add', '-q', '-b', 'malini/ws', worktree, 'origin/main']);
	await realGit(worktree, ['config', 'user.email', 't@example.com']);
	await realGit(worktree, ['config', 'user.name', 't']);
	db = openMigratedDatabase(':memory:');
	upsertProject(db, {
		id: 'p1',
		name: 'p1',
		repoPath: base,
		defaultBranch: 'main',
		createdAt: '2026-10-31T00:00:00.000Z',
	});
	upsertWorkstream(db, {
		id: 'ws',
		projectId: 'p1',
		name: 'ws',
		path: worktree,
		branch: 'malini/ws',
		baseBranch: 'main',
		status: 'active',
		createdAt: '2026-10-31T00:00:00.000Z',
		startedBy: null,
	});
	events = createEventBus({ forwardToWindows: false });
	overlaps = [];
	events.subscribe(REPOSITORIES_WORKSTREAM_BASE_OVERLAPPED_CHANNEL, (payload) => {
		overlaps.push(payload);
	});
	busy = false;
	merging = false;
	ended = false;
	now = NOW;
	fetches = 0;
	checkouts = new Map([['ws', worktree]]);
	watch = watching();
});

afterEach(async () => {
	vi.useRealTimers();
	await watch.dispose();
	db.close();
	await removeDir(root);
});

async function commit(repo: string, files: Readonly<Record<string, string>>): Promise<string> {
	for (const [path, contents] of Object.entries(files)) await writeFile(join(repo, path), contents);
	await realGit(repo, ['add', '-A']);
	await realGit(repo, ['commit', '-q', '-m', Object.keys(files).join(' ')]);
	return (await realGit(repo, ['rev-parse', 'HEAD'])).trim();
}

describe('BaseOverlapWatch', () => {
	it('reports once that main moved onto a file the workstream changed, after it fetches', async () => {
		const head = await commit(worktree, { 'shared.txt': 'workstream\n' });
		const baseHead = await commit(origin, { 'shared.txt': 'main\n' });

		await watch.compare('ws');
		expect(overlaps).toEqual([]);

		await watch.fetchAndCompare();
		await watch.fetchAndCompare();
		expect(overlaps).toEqual([
			{
				workstreamId: 'ws',
				baseBranch: 'main',
				head,
				baseHead,
				behind: 1,
				overlapping: true,
				conflicts: true,
				conflictedPaths: ['shared.txt'],
				overlappingPaths: ['shared.txt'],
			},
		]);
	});

	it('drops a compare still running when the app quits, as the database closes under it', async () => {
		await commit(worktree, { 'shared.txt': 'workstream\n' });
		await commit(origin, { 'shared.txt': 'main\n' });
		busy = true;
		await watch.fetchAndCompare();
		const quitting: BaseOverlapWatch = watching({
			fetchBase: async () => 'refs/remotes/origin/main',
			busy: async () => {
				void quitting.dispose();
				return false;
			},
			merging: async () => {
				throw new Error('statement has been finalized');
			},
		});

		await quitting.compare('ws');
		await quitting.compare('ws');

		expect(overlaps).toEqual([]);
	});

	it('quits only once a fetch still running has finished, so no git outlives the app', async () => {
		let finishFetch = (): void => {};
		const fetching = new Promise<void>((resolve) => {
			finishFetch = resolve;
		});
		const quitting = watching({
			fetchBase: async () => {
				await fetching;
				return 'refs/remotes/origin/main';
			},
		});
		const pass = quitting.fetchAndCompare();
		let quit = false;
		const disposed = (async () => {
			await quitting.dispose();
			quit = true;
		})();

		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(quit).toBe(false);
		finishFetch();
		await Promise.all([pass, disposed]);
		expect(quit).toBe(true);
	});

	it('reports main moving past files the workstream left alone, with overlapping false', async () => {
		const head = await commit(worktree, { 'shared.txt': 'workstream\n' });
		const baseHead = await commit(origin, { 'other.txt': 'main\n' });

		await watch.fetchAndCompare();
		await watch.fetchAndCompare();

		expect(overlaps).toEqual([
			{
				workstreamId: 'ws',
				baseBranch: 'main',
				head,
				baseHead,
				behind: 1,
				overlapping: false,
				conflicts: false,
				conflictedPaths: [],
				overlappingPaths: [],
			},
		]);
	});

	it('reports overlapping false only for a workstream worked in this week, then once it is again', async () => {
		await commit(worktree, { 'shared.txt': 'workstream\n' });
		await commit(origin, { 'other.txt': 'main\n' });
		now = NOW + 8 * DAY_MS;
		workedIn('ws', NOW - DAY_MS);

		await watch.fetchAndCompare();
		await watch.compare('ws');
		expect(overlaps).toEqual([]);

		workedIn('ws', now - DAY_MS);
		await watch.compare('ws');
		await watch.compare('ws');
		expect(overlaps).toMatchObject([{ workstreamId: 'ws', overlapping: false }]);
	});

	it('reports a stale workstream once main touches its files', async () => {
		await commit(worktree, { 'shared.txt': 'workstream\n' });
		await commit(origin, { 'shared.txt': 'main\n' });
		now = NOW + 30 * DAY_MS;

		await watch.fetchAndCompare();

		expect(overlaps).toMatchObject([{ workstreamId: 'ws', overlapping: true }]);
	});

	it('fast-forwards a workstream with no commits of its own and reports nothing', async () => {
		const baseHead = await commit(origin, { 'shared.txt': 'main\n' });
		now = NOW + 30 * DAY_MS;

		await watch.fetchAndCompare();
		await watch.compare('ws');

		expect(await headOf(worktree)).toBe(baseHead);
		expect(await realGit(worktree, ['rev-list', '--merges', '--count', 'HEAD'])).toBe('0\n');
		expect(overlaps).toEqual([]);
	});

	it('leaves a workstream started from a release where it started', async () => {
		const release = await headOf(origin);
		await commit(origin, { 'other.txt': 'after the release\n' });
		await realGit(base, ['fetch', '-q', 'origin', 'main']);
		const pinned = await workstreamAt('pinned', release);
		await commit(origin, { 'shared.txt': 'main\n' });

		await watch.fetchAndCompare();

		expect(await headOf(pinned)).toBe(release);
		expect(overlaps.filter(({ workstreamId }) => workstreamId === 'pinned')).toEqual([]);
	});

	it('waits while an agent works, a service runs or changes are uncommitted, then reports on the next look', async () => {
		await commit(worktree, { 'shared.txt': 'workstream\n' });
		await commit(origin, { 'shared.txt': 'main\n' });
		busy = true;
		await watch.fetchAndCompare();
		busy = false;
		await writeFile(join(worktree, 'draft.txt'), 'not committed yet\n');
		await watch.compare('ws');
		expect(overlaps).toEqual([]);

		await commit(worktree, { 'draft.txt': 'committed\n' });
		await watch.compare('ws');

		expect(overlaps).toMatchObject([{ workstreamId: 'ws', conflicts: true }]);
	});

	it('leaves a workstream to its merge while it merges, then reports once it no longer does', async () => {
		await commit(worktree, { 'shared.txt': 'workstream\n' });
		await commit(origin, { 'shared.txt': 'main\n' });
		merging = true;
		await watch.fetchAndCompare();
		expect(overlaps).toEqual([]);

		merging = false;
		await watch.compare('ws');

		expect(overlaps).toMatchObject([{ workstreamId: 'ws', conflicts: true }]);
	});

	it('leaves a workstream whose pull request merged or closed on GitHub alone', async () => {
		await commit(worktree, { 'shared.txt': 'workstream\n' });
		await commit(origin, { 'shared.txt': 'main\n' });
		ended = true;

		await watch.fetchAndCompare();

		expect(overlaps).toEqual([]);
	});

	it('leaves a workstream whose pull request merged alone', async () => {
		await commit(worktree, { 'shared.txt': 'workstream\n' });
		await commit(origin, { 'shared.txt': 'main\n' });
		recordMergedPullRequest(db, 'ws', { number: 7, url: null });

		await watch.fetchAndCompare();

		expect(overlaps).toEqual([]);
	});

	it('fetches the base right after the merge queue lands a pull request into it', async () => {
		watch.start();
		await vi.waitFor(() => expect(fetches).toBe(1));
		await commit(worktree, { 'shared.txt': 'workstream\n' });
		const baseHead = await commit(origin, { 'shared.txt': 'main\n' });

		events.emit(PULL_REQUESTS_SHIP_CHANGED_CHANNEL, {
			workstreamId: 'ws',
			state: null,
			merged: { pullRequestNumber: 7, pullRequestUrl: null },
		});

		await vi.waitFor(() => expect(overlaps).toMatchObject([{ workstreamId: 'ws', baseHead }]));
		expect(fetches).toBe(2);
	});

	it('waits for main to stay put for the quiet window, then reports its last move once', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		watch = watching({ quietMs: 30_000 });
		await commit(worktree, { 'shared.txt': 'workstream\n' });
		await watch.fetchAndCompare();
		await commit(origin, { 'shared.txt': 'main\n' });
		await watch.fetchAndCompare();
		now += 20_000;
		await vi.advanceTimersByTimeAsync(20_000);
		const last = await commit(origin, { 'shared.txt': 'main again\n' });
		await watch.fetchAndCompare();

		now += 29_000;
		await vi.advanceTimersByTimeAsync(29_000);
		expect(overlaps).toEqual([]);
		now += 1_000;
		await vi.advanceTimersByTimeAsync(1_000);

		await vi.waitFor(() => expect(overlaps).toMatchObject([{ baseHead: last }]));
		await watch.compare('ws');
		expect(overlaps).toHaveLength(1);
	});
});
