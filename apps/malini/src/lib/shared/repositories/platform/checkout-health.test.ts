import { realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
	ipcMain: { handle: vi.fn() },
	BrowserWindow: { getAllWindows: () => [] },
}));

import type { WorkstreamCheckoutHealthPayload } from '$contract/repositories';
import {
	REPOSITORIES_CLONE_PROGRESS_CHANNEL,
	REPOSITORIES_WORKSTREAM_CHECKOUT_HEALTH_CHANNEL,
	type CloneProgressPayload,
} from '$contract/events';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { createEventBus } from '$main/events';
import { initRealRepo, realGit, removeDir, tempDir } from '$main/git/fixtures.test-support';
import { installGitRunnerForTests } from '$main/git/run';
import { CommandRegistry } from '$main/ipc/registry';
import type { RepositoriesPlatform } from '../repositories.platform';
import { HEALTHY } from './checkout-health';
import { WorkstreamError } from './checkout-resolver';
import { upsertConnectedRepository } from './connected-repositories.repository';
import { upsertProject } from './projects.repository';
import { registerRepositories } from './register';
import { archivedLeftoversCleared } from './teardown.service';
import { upsertWorkstream } from './workstreams.repository';

const WORKSTREAM_ID = 'ws1';
const PROJECT_ID = 'local__p1';
const CREATED_AT = '2026-11-21T00:00:00.000Z';

let root: string;
let base: string;
let checkout: string;
let db: MaliniDatabase;
let context: MainContext;
let platform: RepositoriesPlatform;
let restoreGit: () => void = () => undefined;

let healthEvents: WorkstreamCheckoutHealthPayload[] = [];
let cloneEvents: CloneProgressPayload[] = [];

function readFiles(): Promise<unknown> {
	return context.commands.call('repositories.workstream-files', { workstreamId: WORKSTREAM_ID });
}

function countReads(): string[][] {
	const reads: string[][] = [];
	restoreGit = installGitRunnerForTests((args, env, previous) => {
		if (args.includes('ls-files')) reads.push([...args]);
		return previous(args, env);
	});
	return reads;
}

beforeEach(async () => {
	root = await realpath(await tempDir('malini-checkout-health-'));
	base = join(root, 'repositories', 'p1', 'base');
	checkout = join(root, 'workstreams', WORKSTREAM_ID);
	await initRealRepo(base);
	await realGit(base, ['worktree', 'add', '-q', checkout, '-b', `malini/${WORKSTREAM_ID}`]);
	db = openMigratedDatabase(':memory:');
	const events = createEventBus({ forwardToWindows: false });
	healthEvents = [];
	cloneEvents = [];
	events.subscribe(REPOSITORIES_WORKSTREAM_CHECKOUT_HEALTH_CHANNEL, (payload) => {
		healthEvents.push(payload);
	});
	events.subscribe(REPOSITORIES_CLONE_PROGRESS_CHANNEL, (payload) => {
		cloneEvents.push(payload);
	});
	context = {
		db,
		commands: new CommandRegistry(),
		events,
		appDataRoot: root,
		checkoutsRoot: root,
		resourcesRoot: root,
		isDev: true,
		appVersion: '0.0.0-test',
	};
	upsertProject(db, {
		id: PROJECT_ID,
		name: 'p1',
		repoPath: base,
		defaultBranch: 'main',
		createdAt: CREATED_AT,
	});
	upsertWorkstream(db, {
		id: WORKSTREAM_ID,
		projectId: PROJECT_ID,
		name: WORKSTREAM_ID,
		path: checkout,
		branch: `malini/${WORKSTREAM_ID}`,
		baseBranch: 'main',
		status: 'active',
		createdAt: CREATED_AT,
		startedBy: null,
	});
	platform = registerRepositories(context, { startupReclaim: false });
	await archivedLeftoversCleared();
});

afterEach(async () => {
	restoreGit();
	restoreGit = () => undefined;
	platform.checkoutHealth.dispose();
	platform.watchers.dispose();
	db.close();
	await removeDir(root);
});

describe('checkout health', () => {
	it('a checkout whose repository has no origin to clone costs one git read, not fifty', async () => {
		await rename(base, `${base}-moved`);
		const reads = countReads();

		const failures: unknown[] = [];
		for (let read = 0; read < 50; read += 1) {
			await readFiles().catch((error: unknown) => failures.push(error));
		}

		expect(reads).toHaveLength(1);
		expect(failures).toHaveLength(50);
		const [discovery, ...after] = failures;
		expect(discovery).not.toBeInstanceOf(WorkstreamError);
		for (const failure of after) {
			expect(failure).toBeInstanceOf(WorkstreamError);
			expect(failure).toMatchObject({ kind: 'checkout-broken', verdict: 'expected' });
		}
		const finding = 'base-repository-missing';
		const broken = { ...HEALTHY, state: 'broken', finding, repairable: true };
		expect(healthEvents).toEqual([
			{ workstreamId: WORKSTREAM_ID, ...broken, state: 'repairing' },
			{ workstreamId: WORKSTREAM_ID, ...broken },
		]);
		expect(
			await context.commands.call('repositories.checkout-health', { workstreamId: WORKSTREAM_ID }),
		).toEqual(broken);
	});

	it('a checkout Malini can repair repairs itself, and the reads that found it go through', async () => {
		await writeFile(join(checkout, 'work.txt'), 'uncommitted\n');
		await rm(join(base, '.git', 'worktrees', WORKSTREAM_ID), { recursive: true, force: true });

		const reads = await Promise.all(Array.from({ length: 5 }, () => readFiles()));

		expect(reads).toEqual(Array(5).fill([{ path: 'seed.txt' }, { path: 'work.txt' }]));
		expect(healthEvents.map(({ state, finding }) => [state, finding])).toEqual([
			['repairing', 'admin-missing'],
			['healthy', null],
		]);
	});

	it('a read that wraps the gone folder in its own error makes the folder again, and goes through', async () => {
		await rm(checkout, { recursive: true, force: true });
		let attempts = 0;

		const value = await platform.checkoutHealth.read(WORKSTREAM_ID, async () => {
			attempts += 1;
			if (attempts === 1) {
				await stat(checkout).catch((cause: unknown) => {
					throw new WorkstreamError('open-failed', 'Could not stat the workstream', cause);
				});
			}
			return 'read';
		});

		expect(value).toBe('read');
		expect(healthEvents.map(({ state, finding }) => [state, finding])).toEqual([
			['repairing', 'folder-missing'],
			['healthy', null],
		]);
	});

	it('a probe that finds the checkout fixed sets it healthy', async () => {
		await rename(base, `${base}-moved`);
		await expect(readFiles()).rejects.toThrow();
		await expect(readFiles()).rejects.toMatchObject({ kind: 'checkout-broken' });

		await rename(`${base}-moved`, base);
		platform.checkoutHealth.probeBroken();

		expect(
			await context.commands.call('repositories.checkout-health', { workstreamId: WORKSTREAM_ID }),
		).toEqual(HEALTHY);
		expect(healthEvents.map(({ state, finding }) => [state, finding])).toEqual([
			['repairing', 'base-repository-missing'],
			['broken', 'base-repository-missing'],
			['healthy', null],
		]);
		expect(await readFiles()).toEqual([{ path: 'seed.txt' }]);
	});

	it('a checkouts folder that comes back with a break Malini can repair repairs itself', async () => {
		await writeFile(join(checkout, 'work.txt'), 'uncommitted\n');
		await rename(root, `${root}-unplugged`);
		await expect(readFiles()).rejects.toThrow();

		await rm(
			join(`${root}-unplugged`, 'repositories', 'p1', 'base', '.git', 'worktrees', WORKSTREAM_ID),
			{
				recursive: true,
				force: true,
			},
		);
		await rename(`${root}-unplugged`, root);
		platform.checkoutHealth.probeBroken();

		await expect
			.poll(() =>
				context.commands.call('repositories.checkout-health', { workstreamId: WORKSTREAM_ID }),
			)
			.toEqual(HEALTHY);
		expect(healthEvents.map(({ state, finding }) => [state, finding])).toEqual([
			['broken', 'checkouts-folder-missing'],
			['repairing', 'admin-missing'],
			['healthy', null],
		]);
		expect(await readFiles()).toEqual([{ path: 'seed.txt' }, { path: 'work.txt' }]);
	});

	it('a base clone that is gone clones again from its origin, and the reads that found it go through', async () => {
		const origin = join(root, 'github', 'p1.git');
		await realGit(root, ['clone', '-q', '--bare', '--single-branch', '-b', 'main', base, origin]);
		upsertConnectedRepository(db, {
			id: 'r1',
			fullName: 'acme/p1',
			defaultBranch: 'main',
			localPath: null,
			remoteUrl: origin,
			createdAt: CREATED_AT,
		});
		await writeFile(join(checkout, 'work.txt'), 'uncommitted\n');
		await rm(base, { recursive: true, force: true });

		const reads = await Promise.all(Array.from({ length: 3 }, () => readFiles()));

		expect(reads).toEqual(Array(3).fill([{ path: 'seed.txt' }, { path: 'work.txt' }]));
		expect(await realGit(base, ['remote', 'get-url', 'origin'])).toBe(`${origin}\n`);
		expect(cloneEvents.at(-1)).toEqual({ repo_id: 'p1', stage: 'done', fraction: 1 });
		expect(healthEvents.map(({ state, finding, restored }) => [state, finding, restored])).toEqual([
			['repairing', 'base-repository-missing', null],
			['healthy', null, 'commits-as-edits'],
		]);
		expect(
			await context.commands.call('repositories.checkout-health', { workstreamId: WORKSTREAM_ID }),
		).toEqual({ ...HEALTHY, restored: 'commits-as-edits' });
	});
});
