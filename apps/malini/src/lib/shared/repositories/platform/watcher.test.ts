import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { upsertProject } from './projects.repository';
import { upsertWorkstream, type WorkstreamStatus } from './workstreams.repository';
import { createEventBus, type EventBus } from '$main/events';
import {
	REPOSITORIES_WORKSTREAM_CREATED_CHANNEL,
	REPOSITORIES_WORKSTREAM_FILES_CHANGED_CHANNEL,
	REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL,
} from '$contract/events';
import {
	createWorkstreamWatchers,
	type WorkstreamFilesChangedPayload,
	type WorkstreamWatchers,
} from './watcher';

const execFileAsync = promisify(execFile);

const DEBOUNCE_MS = 150;
const MAX_WAIT_MS = 400;
const SETTLE_MS = 700;

let root: string;
let db: MaliniDatabase;
let events: EventBus;
let watchers: WorkstreamWatchers;
let emitted: WorkstreamFilesChangedPayload[];
let logged: string[];
const worktrees = new Map<string, string>();

async function initRepo(path: string): Promise<void> {
	mkdirSync(path, { recursive: true });
	await execFileAsync('git', ['init', '-q', '-b', 'main'], { cwd: path });
	writeFileSync(join(path, 'seed.txt'), 'seed\n');
}

function seedRow(id: string, path: string, status: WorkstreamStatus): void {
	upsertProject(db, {
		id: 'p1',
		name: 'p1',
		repoPath: join(root, 'base'),
		defaultBranch: 'main',
		createdAt: '2026-09-18T00:00:00.000Z',
	});
	upsertWorkstream(db, {
		id,
		projectId: 'p1',
		name: id,
		path,
		branch: `malini/${id}`,
		baseBranch: 'main',
		status,
		createdAt: '2026-09-18T00:00:00.000Z',
	});
	worktrees.set(id, path);
}

function filesChangedPayload(payload: unknown): WorkstreamFilesChangedPayload {
	if (typeof payload !== 'object' || payload === null) throw new Error('frame is not an object');
	const workstreamId = Reflect.get(payload, 'workstreamId');
	const changedAt = Reflect.get(payload, 'changedAt');
	if (typeof workstreamId !== 'string' || typeof changedAt !== 'string') {
		throw new Error('frame is missing workstreamId or changedAt');
	}
	return { workstreamId, changedAt };
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error('timed out waiting for the watcher');
		await sleep(20);
	}
}

async function watchSettled(id: string): Promise<void> {
	await watchers.watch(id);
	await sleep(SETTLE_MS);
	emitted.length = 0;
}

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), 'malini-watcher-')));
	db = openMigratedDatabase(':memory:');
	events = createEventBus({ forwardToWindows: false });
	emitted = [];
	logged = [];
	worktrees.clear();
	events.subscribe(REPOSITORIES_WORKSTREAM_FILES_CHANGED_CHANNEL, (payload) => {
		emitted.push(filesChangedPayload(payload));
	});
	watchers = createWorkstreamWatchers({
		db,
		events,
		resolveWorktree: async (workstreamId) => {
			const path = worktrees.get(workstreamId);
			if (!path) throw new Error(`no checkout for ${workstreamId}`);
			return path;
		},
		debounceMs: DEBOUNCE_MS,
		maxWaitMs: MAX_WAIT_MS,
		log: (line) => logged.push(line),
	});
});

afterEach(() => {
	watchers.dispose();
	db.close();
	rmSync(root, { recursive: true, force: true });
});

describe('createWorkstreamWatchers', () => {
	it('emits once after the debounce for a write under the worktree', async () => {
		const path = join(root, 'ws-1');
		await initRepo(path);
		seedRow('ws-1', path, 'active');
		await watchSettled('ws-1');

		writeFileSync(join(path, 'seed.txt'), 'changed\n');
		await waitFor(() => emitted.length === 1);
		await sleep(SETTLE_MS);

		expect(emitted).toHaveLength(1);
		expect(emitted[0]?.workstreamId).toBe('ws-1');
		expect(Number.isNaN(Date.parse(emitted[0]?.changedAt ?? ''))).toBe(false);
	});

	it('coalesces a burst of writes into one frame', async () => {
		const path = join(root, 'ws-1');
		await initRepo(path);
		seedRow('ws-1', path, 'active');
		await watchSettled('ws-1');

		for (let index = 0; index < 10; index += 1) {
			writeFileSync(join(path, `file-${index}.txt`), `${index}\n`);
			await sleep(5);
		}
		await waitFor(() => emitted.length === 1);
		await sleep(SETTLE_MS);

		expect(emitted).toHaveLength(1);
	});

	it('keeps flushing at the max wait while a burst never goes quiet', async () => {
		const path = join(root, 'ws-1');
		await initRepo(path);
		seedRow('ws-1', path, 'active');
		await watchSettled('ws-1');

		const stopAt = Date.now() + MAX_WAIT_MS * 2 + DEBOUNCE_MS;
		let index = 0;
		while (Date.now() < stopAt) {
			writeFileSync(join(path, `burst-${index}.txt`), `${index}\n`);
			index += 1;
			await sleep(DEBOUNCE_MS / 3);
		}
		await sleep(SETTLE_MS);

		expect(emitted.length).toBeGreaterThanOrEqual(2);
	});

	it('ignores skipped directories and the git index', async () => {
		const path = join(root, 'ws-1');
		await initRepo(path);
		mkdirSync(join(path, 'node_modules', 'dep'), { recursive: true });
		seedRow('ws-1', path, 'active');
		await watchSettled('ws-1');

		writeFileSync(join(path, 'node_modules', 'dep', 'index.js'), 'module.exports = 1;\n');
		writeFileSync(join(path, '.git', 'index'), 'DIRC');
		writeFileSync(join(path, '.git', 'HEAD.lock'), 'ref: refs/heads/main\n');
		await sleep(SETTLE_MS);

		expect(emitted).toEqual([]);
	});

	it('emits when a ref under the common dir moves', async () => {
		const path = join(root, 'ws-1');
		await initRepo(path);
		mkdirSync(join(path, '.git', 'refs', 'heads'), { recursive: true });
		seedRow('ws-1', path, 'active');
		await watchSettled('ws-1');

		writeFileSync(join(path, '.git', 'refs', 'heads', 'topic'), `${'a'.repeat(40)}\n`);
		await waitFor(() => emitted.length === 1);

		expect(emitted[0]?.workstreamId).toBe('ws-1');
	});

	it('emits when HEAD moves in the git dir', async () => {
		const path = join(root, 'ws-1');
		await initRepo(path);
		seedRow('ws-1', path, 'active');
		await watchSettled('ws-1');

		writeFileSync(join(path, '.git', 'HEAD'), 'ref: refs/heads/topic\n');
		await waitFor(() => emitted.length === 1);

		expect(emitted[0]?.workstreamId).toBe('ws-1');
	});

	it('stops emitting once unwatched', async () => {
		const path = join(root, 'ws-1');
		await initRepo(path);
		seedRow('ws-1', path, 'active');
		await watchSettled('ws-1');

		watchers.unwatch('ws-1');
		expect(watchers.isWatching('ws-1')).toBe(false);
		writeFileSync(join(path, 'seed.txt'), 'changed\n');
		await sleep(SETTLE_MS);

		expect(emitted).toEqual([]);
	});

	it('watches only the active rows at start and follows worktree events after', async () => {
		const active = join(root, 'ws-active');
		const archived = join(root, 'ws-archived');
		const later = join(root, 'ws-later');
		await Promise.all([initRepo(active), initRepo(archived), initRepo(later)]);
		seedRow('ws-active', active, 'active');
		seedRow('ws-archived', archived, 'archived');
		worktrees.set('ws-later', later);

		await watchers.start();
		expect(watchers.isWatching('ws-active')).toBe(true);
		expect(watchers.isWatching('ws-archived')).toBe(false);
		expect(watchers.isWatching('ws-later')).toBe(false);

		events.emit(REPOSITORIES_WORKSTREAM_CREATED_CHANNEL, {
			workstreamId: 'ws-later',
			project: {
				id: 'project-1',
				name: 'project-1',
				repoPath: later,
				defaultBranch: 'main',
				createdAt: '2026-01-01T00:00:00.000Z',
			},
			workstream: {
				id: 'ws-later',
				projectId: 'project-1',
				name: 'ws-later',
				path: later,
				branch: 'malini/ws-later',
				baseBranch: 'main',
				status: 'active',
				createdAt: '2026-01-01T00:00:00.000Z',
			},
		});
		await waitFor(() => watchers.isWatching('ws-later'));

		events.emit(REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL, {
			workstreamId: 'ws-active',
			worktreePath: active,
			deleted: true,
		});
		expect(watchers.isWatching('ws-active')).toBe(false);
	});

	it('logs and skips a workstream whose checkout cannot be resolved', async () => {
		await watchers.watch('ws-missing');

		expect(watchers.isWatching('ws-missing')).toBe(false);
		expect(logged).toHaveLength(1);
		expect(logged[0]).toContain('ws-missing');
	});

	it('lets an unwatch during resolution win', async () => {
		const path = join(root, 'ws-1');
		await initRepo(path);
		seedRow('ws-1', path, 'active');

		const watching = watchers.watch('ws-1');
		watchers.unwatch('ws-1');
		await watching;

		expect(watchers.isWatching('ws-1')).toBe(false);
	});

	it('says nothing about starts that a dispose cancelled', async () => {
		const plainDirectory = join(root, 'plain');
		mkdirSync(plainDirectory);
		seedRow('ws-plain', plainDirectory, 'active');

		const starts = [watchers.watch('ws-plain'), watchers.watch('ws-missing')];
		watchers.dispose();
		await Promise.all(starts);

		expect(watchers.isWatching('ws-plain')).toBe(false);
		expect(logged).toEqual([]);
	});
});
