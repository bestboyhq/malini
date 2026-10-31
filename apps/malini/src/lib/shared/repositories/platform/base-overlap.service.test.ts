import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	REPOSITORIES_WORKSTREAM_BASE_OVERLAPPED_CHANNEL,
	type WorkstreamBaseOverlappedPayload,
} from '$contract/events';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { createEventBus, type EventBus } from '$main/events';
import { initRealRepo, realGit, removeDir, tempDir } from '$main/git/fixtures.test-support';
import { BaseOverlapWatch } from './base-overlap.service';
import { upsertProject } from './projects.repository';
import { recordMergedPullRequest, upsertWorkstream } from './workstreams.repository';

let root: string;
let origin: string;
let worktree: string;
let db: MaliniDatabase;
let events: EventBus;
let working: boolean;
let merging: boolean;
let ended: boolean;
let overlaps: WorkstreamBaseOverlappedPayload[];
let watch: BaseOverlapWatch;

beforeEach(async () => {
	root = await tempDir('malini-base-overlap-');
	origin = join(root, 'origin');
	const base = join(root, 'base');
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
		scope: null,
		startedBy: null,
	});
	events = createEventBus({ forwardToWindows: false });
	overlaps = [];
	events.subscribe(REPOSITORIES_WORKSTREAM_BASE_OVERLAPPED_CHANNEL, (payload) => {
		overlaps.push(payload);
	});
	working = false;
	merging = false;
	ended = false;
	watch = new BaseOverlapWatch({
		db,
		events,
		checkouts: {
			resolveCheckout: async () => worktree,
			resolveRepositoryRoot: async () => base,
		},
		fetchBase: async (repoPath, baseBranch) => {
			await realGit(repoPath, ['fetch', '-q', 'origin', baseBranch]);
			return `refs/remotes/origin/${baseBranch}`;
		},
		agentWorking: async () => working,
		merging: async () => merging,
		pullRequestEnded: async () => ended,
		log: (line) => {
			throw new Error(line);
		},
	});
});

afterEach(async () => {
	watch.dispose();
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
				conflicts: true,
				conflictedPaths: ['shared.txt'],
				overlappingPaths: ['shared.txt'],
			},
		]);
	});

	it('reports nothing when main changed only files the workstream left alone', async () => {
		await commit(worktree, { 'shared.txt': 'workstream\n' });
		await commit(origin, { 'other.txt': 'main\n' });

		await watch.fetchAndCompare();

		expect(overlaps).toEqual([]);
	});

	it('waits while an agent works or changes are uncommitted, then reports on the next look', async () => {
		await commit(worktree, { 'shared.txt': 'workstream\n' });
		await commit(origin, { 'shared.txt': 'main\n' });
		working = true;
		await watch.fetchAndCompare();
		working = false;
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
});
