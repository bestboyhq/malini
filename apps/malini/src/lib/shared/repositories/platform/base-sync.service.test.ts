import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
	ipcMain: { handle: vi.fn() },
	BrowserWindow: { getAllWindows: () => [] },
}));

import type { MainContext } from '$main/context';
import { openMigratedDatabase } from '$main/db/open';
import { createEventBus } from '$main/events';
import { realGit, removeDir, tempDir, workstreamFixture } from '$main/git/fixtures.test-support';
import { installGitRunnerForTests } from '$main/git/run';
import { CommandRegistry } from '$main/ipc/registry';
import { registerRepositories } from './register';
import { archivedLeftoversCleared } from './teardown.service';

const execFileAsync = promisify(execFile);

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	while (cleanups.length > 0) await cleanups.pop()?.();
});

type Harness = Readonly<{
	dir: string;
	remote: string;
	base: string;
	invoke: (command: string, args: unknown) => Promise<unknown>;
}>;

async function harness(): Promise<Harness> {
	const dir = await tempDir();
	cleanups.push(() => removeDir(dir));
	const { remote, base } = await workstreamFixture(dir, 'ws-seed');
	const commands = new CommandRegistry();
	const context: MainContext = {
		db: openMigratedDatabase(':memory:'),
		commands,
		events: createEventBus({ forwardToWindows: false }),
		appDataRoot: dir,
		resourcesRoot: dir,
		isDev: true,
		appVersion: '0.0.0-test',
	};
	const platform = registerRepositories(context, {
		shell: { reveal: async () => {}, openInEditor: async () => {} },
		startupReclaim: false,
	});
	cleanups.push(async () => {
		platform.watchers.dispose();
		await archivedLeftoversCleared();
		context.db.close();
	});
	const invoke = async (command: string, args: unknown): Promise<unknown> => {
		const response = await commands.invoke({ command, args });
		if (!response.ok) throw new Error(response.error);
		return response.value;
	};
	return { dir, remote, base, invoke };
}

async function createWorkstream(harness: Harness, workstreamId: string): Promise<string> {
	const path = await harness.invoke('repositories.create-workstream', {
		projectRepoPath: harness.base,
		workstreamId,
		baseBranch: 'main',
		projectId: 'proj',
		name: workstreamId,
	});
	if (typeof path !== 'string') throw new Error('create-workstream returned no path');
	return path;
}

async function pushToRemote(harness: Harness, file: string): Promise<string> {
	const clone = join(harness.dir, `pusher-${file}`);
	await realGit(harness.dir, ['clone', '-q', harness.remote, clone]);
	await realGit(clone, ['config', 'user.email', 't@example.com']);
	await realGit(clone, ['config', 'user.name', 't']);
	await writeFile(join(clone, file), `${file}\n`);
	await realGit(clone, ['add', file]);
	await realGit(clone, ['commit', '-q', '-m', `add ${file}`]);
	await realGit(clone, ['push', '-q', 'origin', 'main']);
	return (await realGit(clone, ['rev-parse', 'HEAD'])).trim();
}

async function head(checkout: string): Promise<string> {
	return (await realGit(checkout, ['rev-parse', 'HEAD'])).trim();
}

function countFetches(): { fetches: () => number } {
	let fetches = 0;
	const restore = installGitRunnerForTests(async (args, env) => {
		if (args.includes('fetch')) fetches += 1;
		const { stdout } = await execFileAsync('git', [...args], {
			env: { ...process.env, ...env },
		});
		return stdout;
	});
	cleanups.push(async () => restore());
	return { fetches: () => fetches };
}

type HeldGit = Readonly<{ reached: Promise<void>; release: () => void }>;

function controlledGit(): {
	hold: (verb: string) => HeldGit;
	ran: (verb: string) => boolean;
} {
	const log: string[] = [];
	const holds = new Map<string, { reached: () => void; released: Promise<void> }>();
	const restore = installGitRunnerForTests(async (args, env) => {
		const line = args.join(' ');
		for (const [verb, held] of holds) {
			if (!line.includes(` ${verb} `) && !line.endsWith(` ${verb}`)) continue;
			holds.delete(verb);
			held.reached();
			await held.released;
		}
		const { stdout } = await execFileAsync('git', [...args], {
			env: { ...process.env, ...env },
		});
		log.push(line);
		return stdout;
	});
	cleanups.push(async () => restore());
	const indexOf = (verb: string): number => log.findIndex((line) => line.includes(` ${verb} `));
	return {
		hold: (verb) => {
			let reached: () => void = () => undefined;
			let release: () => void = () => undefined;
			const reachedPromise = new Promise<void>((resolve) => {
				reached = resolve;
			});
			const released = new Promise<void>((resolve) => {
				release = resolve;
			});
			holds.set(verb, { reached, released });
			return { reached: reachedPromise, release };
		},
		ran: (verb) => indexOf(verb) !== -1,
	};
}

describe('creating a workstream', () => {
	it('branches from the base it already has, without waiting on the remote', async () => {
		const repo = await harness();
		const recordedBase = (await realGit(repo.base, ['rev-parse', 'origin/main'])).trim();
		await rename(repo.remote, `${repo.remote}-unreachable`);

		const checkout = await createWorkstream(repo, 'ws-offline');

		expect(await head(checkout)).toBe(recordedBase);
		expect(existsSync(join(checkout, 'seed.txt'))).toBe(true);
	});

	it('fetches once, not twice, when it has never seen the base branch', async () => {
		const repo = await harness();
		await realGit(repo.base, ['update-ref', '-d', 'refs/remotes/origin/main']);
		const counter = countFetches();

		const checkout = await createWorkstream(repo, 'ws-first');
		const synced = await repo.invoke('repositories.sync-workstream-base', {
			workstreamId: 'ws-first',
		});

		expect(synced).toBe('current');
		expect(counter.fetches()).toBe(1);
		expect(await head(checkout)).toBe((await realGit(repo.remote, ['rev-parse', 'main'])).trim());
	});

	it('syncs a retried workstream whose first attempt fetched and then failed', async () => {
		const repo = await harness();
		await realGit(repo.base, ['update-ref', '-d', 'refs/remotes/origin/main']);
		await realGit(repo.base, ['branch', 'malini/ws-retry', 'main']);
		await expect(createWorkstream(repo, 'ws-retry')).rejects.toThrow('branch already exists');
		await realGit(repo.base, ['branch', '-D', 'malini/ws-retry']);
		const pushed = await pushToRemote(repo, 'upstream.txt');

		const checkout = await createWorkstream(repo, 'ws-retry');

		expect(
			await repo.invoke('repositories.sync-workstream-base', { workstreamId: 'ws-retry' }),
		).toBe('advanced');
		expect(await head(checkout)).toBe(pushed);
	});
});

describe('syncing a new workstream with its base', () => {
	it('fast-forwards an untouched workstream to the newest remote base', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-fresh');
		const pushed = await pushToRemote(repo, 'upstream.txt');

		expect(
			await repo.invoke('repositories.sync-workstream-base', { workstreamId: 'ws-fresh' }),
		).toBe('advanced');

		expect(await head(checkout)).toBe(pushed);
		expect(existsSync(join(checkout, 'upstream.txt'))).toBe(true);
		expect((await realGit(checkout, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe(
			'malini/ws-fresh',
		);
	});

	it('reports current when the base has not moved', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-current');
		const before = await head(checkout);

		expect(
			await repo.invoke('repositories.sync-workstream-base', { workstreamId: 'ws-current' }),
		).toBe('current');
		expect(await head(checkout)).toBe(before);
	});

	it('leaves a workstream that already has its own commits where it is', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-busy');
		await realGit(checkout, ['config', 'user.email', 't@example.com']);
		await realGit(checkout, ['config', 'user.name', 't']);
		await writeFile(join(checkout, 'mine.txt'), 'mine\n');
		await realGit(checkout, ['add', 'mine.txt']);
		await realGit(checkout, ['commit', '-q', '-m', 'mine']);
		const own = await head(checkout);
		await pushToRemote(repo, 'upstream.txt');

		expect(
			await repo.invoke('repositories.sync-workstream-base', { workstreamId: 'ws-busy' }),
		).toBe('diverged');
		expect(await head(checkout)).toBe(own);
		expect(existsSync(join(checkout, 'upstream.txt'))).toBe(false);
	});

	it('shares one fetch between workstreams syncing the same base at once', async () => {
		const repo = await harness();
		const first = await createWorkstream(repo, 'ws-one');
		const second = await createWorkstream(repo, 'ws-two');
		const pushed = await pushToRemote(repo, 'upstream.txt');
		const counter = countFetches();

		expect(
			await Promise.all([
				repo.invoke('repositories.sync-workstream-base', { workstreamId: 'ws-one' }),
				repo.invoke('repositories.sync-workstream-base', { workstreamId: 'ws-two' }),
			]),
		).toEqual(['advanced', 'advanced']);
		expect(counter.fetches()).toBe(1);
		expect(await head(first)).toBe(pushed);
		expect(await head(second)).toBe(pushed);
	});

	it('fails without touching the checkout when the remote cannot be reached', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-unreachable');
		const before = await head(checkout);
		await rename(repo.remote, `${repo.remote}-unreachable`);

		await expect(
			repo.invoke('repositories.sync-workstream-base', { workstreamId: 'ws-unreachable' }),
		).rejects.toThrow();
		expect(await head(checkout)).toBe(before);
	});

	it('lets an archive cancel a sync still waiting on the network, without merging', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-leaving');
		await pushToRemote(repo, 'upstream.txt');
		const git = controlledGit();
		const fetch = git.hold('fetch');

		const synced = repo.invoke('repositories.sync-workstream-base', {
			workstreamId: 'ws-leaving',
		});
		await fetch.reached;
		await repo.invoke('repositories.archive-workstream', { workstreamId: 'ws-leaving' });
		expect(existsSync(checkout)).toBe(false);
		fetch.release();

		expect(await synced).toBe('cancelled');
		expect(git.ran('merge')).toBe(false);
	});

	it('makes an archive wait for a fast-forward already running in the checkout', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-merging');
		await pushToRemote(repo, 'upstream.txt');
		const git = controlledGit();
		const merge = git.hold('merge');

		const synced = repo.invoke('repositories.sync-workstream-base', {
			workstreamId: 'ws-merging',
		});
		await merge.reached;
		let archived = false;
		const archiving = (async () => {
			await repo.invoke('repositories.archive-workstream', { workstreamId: 'ws-merging' });
			archived = true;
		})();
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(archived).toBe(false);
		expect(existsSync(checkout)).toBe(true);

		merge.release();

		expect(await synced).toBe('advanced');
		await archiving;
		expect(existsSync(checkout)).toBe(false);
	});

	it('rejects an unknown workstream', async () => {
		const repo = await harness();

		await expect(
			repo.invoke('repositories.sync-workstream-base', { workstreamId: 'ws-none' }),
		).rejects.toThrow('Unknown workstream: ws-none');
	});
});
