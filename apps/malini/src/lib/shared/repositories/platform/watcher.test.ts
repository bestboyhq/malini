import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { cloneFile } from '$main/fs/copy-on-write';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { upsertProject } from './projects.repository';
import { upsertWorkstream, type WorkstreamStatus } from './workstreams.repository';
import { createEventBus, type EventBus } from '$main/events';
import {
	REPOSITORIES_WORKSTREAM_CREATED_CHANNEL,
	REPOSITORIES_WORKSTREAM_FILES_CHANGED_CHANNEL,
	REPOSITORIES_WORKSTREAM_HEAD_MOVED_CHANNEL,
	REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL,
	REPOSITORIES_WORKSTREAM_PUSHED_CHANNEL,
	REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL,
} from '$contract/events';
import {
	createWorkstreamWatchers,
	MAX_RECORDED_CHANGED_PATHS,
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
let facts: Array<Readonly<{ channel: string; payload: unknown }>>;
let logged: string[];
const worktrees = new Map<string, string>();

async function initRepo(path: string): Promise<void> {
	mkdirSync(path, { recursive: true });
	await execFileAsync('git', ['init', '-q', '-b', 'main'], { cwd: path });
	writeFileSync(join(path, 'seed.txt'), 'seed\n');
}

async function git(path: string, ...args: string[]): Promise<string> {
	const { stdout } = await execFileAsync(
		'git',
		['-c', 'user.name=Malini', '-c', 'user.email=malini-test', ...args],
		{ cwd: path },
	);
	return stdout.trim();
}

async function commitAll(path: string, message: string): Promise<string> {
	await git(path, 'add', '-A');
	await git(path, 'commit', '-q', '-m', message);
	return git(path, 'rev-parse', 'HEAD');
}

async function divergedOnSeed(path: string): Promise<void> {
	await commitAll(path, 'Seed');
	await git(path, 'checkout', '-q', '-b', 'topic');
	writeFileSync(join(path, 'seed.txt'), 'topic\n');
	await commitAll(path, 'Topic');
	await git(path, 'checkout', '-q', 'main');
	writeFileSync(join(path, 'seed.txt'), 'main\n');
	await commitAll(path, 'Main');
}

function factsOn(channel: string): unknown[] {
	return facts.filter((fact) => fact.channel === channel).map((fact) => fact.payload);
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
		scope: null,
		startedBy: null,
	});
	worktrees.set(id, path);
}

function filesChangedPayload(payload: unknown): WorkstreamFilesChangedPayload {
	if (typeof payload !== 'object' || payload === null) throw new Error('frame is not an object');
	const workstreamId = Reflect.get(payload, 'workstreamId');
	const changedAt = Reflect.get(payload, 'changedAt');
	const paths: unknown = Reflect.get(payload, 'paths');
	if (typeof workstreamId !== 'string' || typeof changedAt !== 'string') {
		throw new Error('frame is missing workstreamId or changedAt');
	}
	if (
		paths !== null &&
		!(Array.isArray(paths) && paths.every((path) => typeof path === 'string'))
	) {
		throw new Error('frame paths are neither a list of strings nor null');
	}
	return { workstreamId, changedAt, paths };
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
	facts = [];
	logged = [];
	worktrees.clear();
	events.subscribe(REPOSITORIES_WORKSTREAM_FILES_CHANGED_CHANNEL, (payload) => {
		emitted.push(filesChangedPayload(payload));
	});
	for (const channel of [
		REPOSITORIES_WORKSTREAM_HEAD_MOVED_CHANNEL,
		REPOSITORIES_WORKSTREAM_PUSHED_CHANNEL,
		REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL,
	] as const) {
		events.subscribe(channel, (payload: unknown) => facts.push({ channel, payload }));
	}
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
		expect(emitted[0]?.paths).toEqual(
			expect.arrayContaining(Array.from({ length: 10 }, (_, index) => `file-${index}.txt`)),
		);
	});

	it('reports an oversized burst as changed everywhere instead of listing every path', async () => {
		const path = join(root, 'ws-1');
		await initRepo(path);
		mkdirSync(join(path, '.context'));
		seedRow('ws-1', path, 'active');
		await watchSettled('ws-1');

		for (let index = 0; index <= MAX_RECORDED_CHANGED_PATHS; index += 1) {
			writeFileSync(join(path, '.context', `copy-${index}.txt`), `${index}\n`);
		}
		await waitFor(() => emitted.length > 0);
		await sleep(SETTLE_MS);

		expect(emitted.some((frame) => frame.paths === null)).toBe(true);
		expect(emitted.every((frame) => (frame.paths?.length ?? 0) <= MAX_RECORDED_CHANGED_PATHS)).toBe(
			true,
		);
	});

	it('names worktree paths relative to the worktree and starts each burst empty', async () => {
		const path = join(root, 'ws-1');
		await initRepo(path);
		mkdirSync(join(path, '.context'), { recursive: true });
		seedRow('ws-1', path, 'active');
		await watchSettled('ws-1');

		writeFileSync(join(path, '.context', 'shot.png'), 'first\n');
		await waitFor(() => emitted.length === 1);
		await sleep(SETTLE_MS);
		writeFileSync(join(path, 'seed.txt'), 'second\n');
		await waitFor(() => emitted.length === 2);

		expect(emitted[0]?.paths).toContain('.context/shot.png');
		expect(emitted[1]?.paths).toContain('seed.txt');
		expect(emitted[1]?.paths).not.toContain('.context/shot.png');
	});

	it('stays quiet when a file is only cloned, not changed', async () => {
		const path = join(root, 'ws-1');
		await initRepo(path);
		mkdirSync(join(path, '.context'), { recursive: true });
		seedRow('ws-1', path, 'active');
		await watchSettled('ws-1');

		writeFileSync(join(path, '.context', 'take.mp4'), 'take\n');
		await waitFor(() => emitted.length === 1);
		await sleep(SETTLE_MS);
		await cloneFile(join(path, '.context', 'take.mp4'), join(root, 'kept-take.mp4'));
		await sleep(SETTLE_MS);
		expect(emitted).toHaveLength(1);
		writeFileSync(join(path, '.context', 'take.mp4'), 'retake\n');
		await waitFor(() => emitted.length === 2);

		expect(emitted.map((frame) => frame.paths)).toEqual([
			['.context/take.mp4'],
			['.context/take.mp4'],
		]);
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
		expect(emitted[0]?.paths).toEqual([]);
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
				scope: null,
				startedBy: null,
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

	it('reports a commit as the head moving, whoever made it', async () => {
		const path = join(root, 'ws-1');
		await initRepo(path);
		const first = await commitAll(path, 'Seed');
		seedRow('ws-1', path, 'active');
		await watchSettled('ws-1');

		writeFileSync(join(path, 'seed.txt'), 'second\n');
		const second = await commitAll(path, 'Second');
		await waitFor(() => factsOn(REPOSITORIES_WORKSTREAM_HEAD_MOVED_CHANNEL).length === 1);
		await sleep(SETTLE_MS);

		expect(factsOn(REPOSITORIES_WORKSTREAM_HEAD_MOVED_CHANNEL)).toEqual([
			{ workstreamId: 'ws-1', branch: 'main', head: second, previousHead: first },
		]);
		expect(factsOn(REPOSITORIES_WORKSTREAM_PUSHED_CHANNEL)).toEqual([]);
	});

	it('reports the first commit of a branch with no previous head', async () => {
		const path = join(root, 'ws-1');
		await initRepo(path);
		seedRow('ws-1', path, 'active');
		await watchSettled('ws-1');

		const head = await commitAll(path, 'Seed');
		await waitFor(() => factsOn(REPOSITORIES_WORKSTREAM_HEAD_MOVED_CHANNEL).length === 1);

		expect(factsOn(REPOSITORIES_WORKSTREAM_HEAD_MOVED_CHANNEL)).toEqual([
			{ workstreamId: 'ws-1', branch: 'main', head, previousHead: null },
		]);
	});

	it('reports a push once origin holds the new commit of the branch', async () => {
		const origin = join(root, 'origin.git');
		const path = join(root, 'ws-1');
		await execFileAsync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
		await initRepo(path);
		await git(path, 'remote', 'add', 'origin', origin);
		await commitAll(path, 'Seed');
		await git(path, 'push', '-q', '-u', 'origin', 'main');
		seedRow('ws-1', path, 'active');
		await watchSettled('ws-1');

		writeFileSync(join(path, 'seed.txt'), 'pushed\n');
		const head = await commitAll(path, 'Pushed');
		await git(path, 'push', '-q', 'origin', 'main');
		await waitFor(() => factsOn(REPOSITORIES_WORKSTREAM_PUSHED_CHANNEL).length === 1);
		await sleep(SETTLE_MS);

		expect(factsOn(REPOSITORIES_WORKSTREAM_PUSHED_CHANNEL)).toEqual([
			{ workstreamId: 'ws-1', branch: 'main', head },
		]);
	});

	it('reports a merge that stops on conflicts once, though Malini did not start it', async () => {
		const path = join(root, 'ws-1');
		await initRepo(path);
		await divergedOnSeed(path);
		seedRow('ws-1', path, 'active');
		await watchSettled('ws-1');

		await expect(git(path, 'merge', 'topic')).rejects.toThrow();
		await waitFor(() => factsOn(REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL).length === 1);
		writeFileSync(join(path, 'notes.txt'), 'still merging\n');
		await sleep(SETTLE_MS);

		expect(factsOn(REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL)).toEqual([
			{ workstreamId: 'ws-1', baseBranch: 'main', conflictedPaths: ['seed.txt'] },
		]);
	});

	it('reports a conflict Malini saw in its own pull only once', async () => {
		const path = join(root, 'ws-1');
		await initRepo(path);
		await divergedOnSeed(path);
		seedRow('ws-1', path, 'active');
		await watchSettled('ws-1');

		await expect(git(path, 'merge', 'topic')).rejects.toThrow();
		watchers.reportMergeConflict({
			workstreamId: 'ws-1',
			baseBranch: 'main',
			conflictedPaths: ['seed.txt'],
			mergeHead: await git(path, 'rev-parse', 'MERGE_HEAD'),
		});
		await sleep(SETTLE_MS);

		expect(factsOn(REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL)).toHaveLength(1);
	});

	it("reports Malini's own commit the moment it asks, and never again when the watcher catches up", async () => {
		const path = join(root, 'ws-1');
		await initRepo(path);
		const first = await commitAll(path, 'Seed');
		seedRow('ws-1', path, 'active');
		await watchSettled('ws-1');

		writeFileSync(join(path, 'seed.txt'), 'second\n');
		const second = await commitAll(path, 'Second');
		await watchers.refresh('ws-1');

		expect(factsOn(REPOSITORIES_WORKSTREAM_HEAD_MOVED_CHANNEL)).toEqual([
			{ workstreamId: 'ws-1', branch: 'main', head: second, previousHead: first },
		]);
		await sleep(SETTLE_MS);
		expect(factsOn(REPOSITORIES_WORKSTREAM_HEAD_MOVED_CHANNEL)).toHaveLength(1);
	});

	it('reports no git facts for a workstream it stopped watching', async () => {
		const path = join(root, 'ws-1');
		await initRepo(path);
		await commitAll(path, 'Seed');
		seedRow('ws-1', path, 'active');
		await watchSettled('ws-1');

		watchers.unwatch('ws-1');
		writeFileSync(join(path, 'seed.txt'), 'later\n');
		await commitAll(path, 'Later');
		await sleep(SETTLE_MS);

		expect(facts).toEqual([]);
	});
});
