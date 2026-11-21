import { readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
	ipcMain: { handle: vi.fn() },
	BrowserWindow: { getAllWindows: () => [] },
}));

import type { WorkstreamCheckoutHealthPayload } from '$contract/repositories';
import { REPOSITORIES_WORKSTREAM_CHECKOUT_HEALTH_CHANNEL } from '$contract/events';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { createEventBus } from '$main/events';
import { initRealRepo, realGit, removeDir, tempDir } from '$main/git/fixtures.test-support';
import { installGitRunnerForTests } from '$main/git/run';
import { CommandRegistry } from '$main/ipc/registry';
import type { RepositoriesPlatform } from '../repositories.platform';
import { WorkstreamError } from './checkout-resolver';
import { upsertProject } from './projects.repository';
import { registerRepositories } from './register';
import { archivedLeftoversCleared } from './teardown.service';
import { upsertWorkstream } from './workstreams.repository';

const WORKSTREAM_ID = 'ws1';

let root: string;
let base: string;
let checkout: string;
let db: MaliniDatabase;
let context: MainContext;
let platform: RepositoriesPlatform;
let restoreGit: () => void = () => undefined;

let healthEvents: WorkstreamCheckoutHealthPayload[] = [];

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
	events.subscribe(REPOSITORIES_WORKSTREAM_CHECKOUT_HEALTH_CHANNEL, (payload) => {
		healthEvents.push(payload);
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
	const createdAt = '2026-11-21T00:00:00.000Z';
	upsertProject(db, { id: 'p1', name: 'p1', repoPath: base, defaultBranch: 'main', createdAt });
	upsertWorkstream(db, {
		id: WORKSTREAM_ID,
		projectId: 'p1',
		name: WORKSTREAM_ID,
		path: checkout,
		branch: `malini/${WORKSTREAM_ID}`,
		baseBranch: 'main',
		status: 'active',
		createdAt,
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
	it('a broken checkout costs one git read, not fifty', async () => {
		await rm(join(base, '.git', 'worktrees', WORKSTREAM_ID), { recursive: true, force: true });
		const reads = countReads();

		const failures: unknown[] = [];
		for (let read = 0; read < 50; read += 1) {
			await readFiles().catch((error: unknown) => failures.push(error));
		}

		expect(reads).toHaveLength(1);
		expect(failures).toHaveLength(50);
		const [discovery, ...after] = failures;
		expect(discovery).toMatchObject({
			name: 'GitError',
			kind: 'git',
			facts: { said: 'not-a-work-tree' },
		});
		expect(after).toHaveLength(49);
		for (const failure of after) {
			expect(failure).toBeInstanceOf(WorkstreamError);
			expect(failure).toMatchObject({ kind: 'checkout-broken', verdict: 'expected' });
		}
		expect(healthEvents).toEqual([
			{ workstreamId: WORKSTREAM_ID, state: 'broken', finding: 'admin-missing', repairable: true },
		]);
		expect(
			await context.commands.call('repositories.checkout-health', { workstreamId: WORKSTREAM_ID }),
		).toEqual({ state: 'broken', finding: 'admin-missing', repairable: true });
	});

	it('reads that fail together send one git error and wait on one diagnosis', async () => {
		await rm(join(base, '.git', 'worktrees', WORKSTREAM_ID), { recursive: true, force: true });

		const settled = await Promise.allSettled(Array.from({ length: 5 }, () => readFiles()));
		const failures = settled.map((result) => (result.status === 'rejected' ? result.reason : null));

		expect(failures.filter((failure) => failure instanceof WorkstreamError)).toHaveLength(4);
		expect(failures.filter((failure) => !(failure instanceof WorkstreamError))).toEqual([
			expect.objectContaining({
				name: 'GitError',
				facts: expect.objectContaining({ said: 'not-a-work-tree' }),
			}),
		]);
		expect(healthEvents).toHaveLength(1);
	});

	it('Repair brings the checkout back to healthy without a restart', async () => {
		await writeFile(join(checkout, 'work.txt'), 'uncommitted\n');
		await rm(join(base, '.git', 'worktrees', WORKSTREAM_ID), { recursive: true, force: true });
		await expect(readFiles()).rejects.toMatchObject({ name: 'GitError' });

		const repaired = await context.commands.call('repositories.repair-checkout', {
			workstreamId: WORKSTREAM_ID,
		});

		expect(repaired).toEqual({ state: 'healthy', finding: null, repairable: false });
		expect(healthEvents.map(({ state, finding }) => [state, finding])).toEqual([
			['broken', 'admin-missing'],
			['repairing', 'admin-missing'],
			['healthy', null],
		]);
		expect(await readFiles()).toEqual([{ path: 'seed.txt' }, { path: 'work.txt' }]);
	});

	it('a probe that finds the checkout fixed sets it healthy', async () => {
		const link = await readFile(join(checkout, '.git'), 'utf8');
		await rm(join(checkout, '.git'));
		await expect(readFiles()).rejects.toMatchObject({ name: 'GitError', kind: 'io' });
		await expect(readFiles()).rejects.toMatchObject({ kind: 'checkout-broken' });

		await writeFile(join(checkout, '.git'), link);
		platform.checkoutHealth.probeBroken();

		expect(
			await context.commands.call('repositories.checkout-health', { workstreamId: WORKSTREAM_ID }),
		).toEqual({ state: 'healthy', finding: null, repairable: false });
		expect(healthEvents.map(({ state, finding }) => [state, finding])).toEqual([
			['broken', 'git-link-missing'],
			['healthy', null],
		]);
		expect(await readFiles()).toEqual([{ path: 'seed.txt' }]);
	});
});
