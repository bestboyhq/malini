import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
	ipcMain: { handle: vi.fn() },
	BrowserWindow: { getAllWindows: () => [] },
}));

import type { MainContext } from '$main/context';
import { openMigratedDatabase } from '$main/db/open';
import { run } from '$main/db/rows';
import { currentLogPath, diagnosticsDirectory } from '$main/diagnostics/diagnostics-files';
import { MainDiagnosticsLog } from '$main/diagnostics/main-diagnostics';
import { createEventBus } from '$main/events';
import { realGit, removeDir, tempDir, workstreamFixture } from '$main/git/fixtures.test-support';
import { installGitRunnerForTests } from '$main/git/run';
import { CommandRegistry } from '$main/ipc/registry';
import { registerRepositories } from './register';
import {
	archivedLeftoversCleared,
	checkoutTrashRoot,
	restoreStrandedCheckouts,
} from './teardown.service';
import { getWorkstream } from './workstreams.repository';

const execFileAsync = promisify(execFile);

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	while (cleanups.length > 0) await cleanups.pop()?.();
});

type Harness = Readonly<{
	dir: string;
	base: string;
	db: MainContext['db'];
	invoke: (command: string, args: unknown) => Promise<unknown>;
	failureCode: (command: string, args: unknown) => Promise<string | null>;
	diagnostics: () => Promise<ReadonlyArray<Record<string, unknown>>>;
	restart: () => Promise<void>;
}>;

async function harness(): Promise<Harness> {
	const dir = await tempDir();
	cleanups.push(async () => {
		await execFileAsync('chmod', ['-R', 'u+w', dir]);
		await removeDir(dir);
	});
	const { base } = await workstreamFixture(dir, 'ws-seed');
	const db = openMigratedDatabase(':memory:');
	cleanups.push(async () => db.close());
	const diagnosticsLog = new MainDiagnosticsLog({
		appDataRoot: dir,
		runtime: { productName: 'malini', bundleIdentifier: 'test', version: '0.0.0', pid: 1 },
	});
	let commands = new CommandRegistry();
	const start = (): void => {
		commands = new CommandRegistry();
		commands.observeFailures((failed) => diagnosticsLog.recordCommandFailure(failed));
		const context: MainContext = {
			db,
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
		});
	};
	start();
	const invoke = async (command: string, args: unknown): Promise<unknown> => {
		const response = await commands.invoke({ command, args });
		if (!response.ok) throw new Error(response.error);
		return response.value;
	};
	const failureCode = async (command: string, args: unknown): Promise<string | null> => {
		const reply = await commands.handle({ command, args });
		return reply.ok ? null : reply.failure.code;
	};
	const diagnostics = async (): Promise<ReadonlyArray<Record<string, unknown>>> => {
		const lines = await readFile(currentLogPath(diagnosticsDirectory(dir), 'main'), 'utf8');
		return lines
			.trim()
			.split('\n')
			.map((line): Record<string, unknown> => JSON.parse(line));
	};
	const restart = async (): Promise<void> => {
		await restoreStrandedCheckouts(db, dir);
		start();
	};
	return { dir, base, db, invoke, failureCode, diagnostics, restart };
}

async function createWorkstream(repo: Harness, workstreamId: string): Promise<string> {
	const path = await repo.invoke('repositories.create-workstream', {
		projectRepoPath: repo.base,
		workstreamId,
		baseBranch: 'main',
		projectId: 'proj',
		name: workstreamId,
	});
	if (typeof path !== 'string') throw new Error('create-workstream returned no path');
	await writeFile(join(path, 'uncommitted.txt'), 'work in progress\n');
	return path;
}

async function readOnlyTree(root: string): Promise<void> {
	const deep = join(root, 'pkg', 'mod');
	await mkdir(deep, { recursive: true });
	await writeFile(join(deep, 'module.go'), 'package mod\n');
	await chmod(join(deep, 'module.go'), 0o444);
	for (const path of [deep, join(root, 'pkg'), root]) await chmod(path, 0o555);
}

function holdGit(verb: string): Readonly<{ reached: Promise<void>; release: () => void }> {
	let reached: () => void = () => undefined;
	let release: () => void = () => undefined;
	const reachedPromise = new Promise<void>((resolve) => {
		reached = resolve;
	});
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	let held = false;
	const restore = installGitRunnerForTests(async (args, env) => {
		if (!held && args.includes(verb)) {
			held = true;
			reached();
			await released;
		}
		const { stdout } = await execFileAsync('git', [...args], {
			env: { ...process.env, ...env },
		});
		return stdout;
	});
	cleanups.push(async () => restore());
	return { reached: reachedPromise, release };
}

async function isIntactCheckout(checkout: string, workstreamId: string): Promise<boolean> {
	const branch = (await realGit(checkout, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
	return (
		branch === `malini/${workstreamId}` &&
		existsSync(join(checkout, 'seed.txt')) &&
		existsSync(join(checkout, 'uncommitted.txt'))
	);
}

async function trashEntries(repo: Harness): Promise<string[]> {
	try {
		return await readdir(checkoutTrashRoot(repo.dir));
	} catch {
		return [];
	}
}

describe('archiving a workstream', () => {
	it('leaves the checkout and the row intact when the checkout cannot be moved aside', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-kept');
		await mkdir(checkoutTrashRoot(repo.dir), { recursive: true });
		await chmod(checkoutTrashRoot(repo.dir), 0o555);
		cleanups.push(() => chmod(checkoutTrashRoot(repo.dir), 0o755));
		await expect(
			repo.invoke('repositories.archive-workstream', { workstreamId: 'ws-kept' }),
		).rejects.toThrow(
			/^Its checkout could not be moved aside \(permission denied\), so nothing was removed$/,
		);

		expect(
			await repo.failureCode('repositories.archive-workstream', { workstreamId: 'ws-kept' }),
		).toBe('EACCES');
		expect(getWorkstream(repo.db, 'ws-kept')).not.toBeNull();
		expect(await isIntactCheckout(checkout, 'ws-kept')).toBe(true);
		expect(await realGit(repo.base, ['worktree', 'list', '--porcelain'])).toContain('ws-kept');
	});

	it('puts the checkout back when the row cannot be removed', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-running');
		run(
			repo.db,
			'INSERT INTO agent_sessions (id, workstream_id, model, status, started_at) VALUES (?, ?, ?, ?, ?)',
			'sess-1',
			'ws-running',
			null,
			'running',
			new Date().toISOString(),
		);
		run(
			repo.db,
			'INSERT INTO agent_runs (id, session_id, prompt, started_at) VALUES (?, ?, ?, ?)',
			'run-1',
			'sess-1',
			'do it',
			new Date().toISOString(),
		);

		await expect(
			repo.invoke('repositories.archive-workstream', { workstreamId: 'ws-running' }),
		).rejects.toThrow(/^An agent is still running in it, so nothing was removed$/);

		expect(getWorkstream(repo.db, 'ws-running')).not.toBeNull();
		expect(await isIntactCheckout(checkout, 'ws-running')).toBe(true);
		expect(await trashEntries(repo)).toEqual([]);
	});

	it('archives a checkout that holds a read-only tree, leaving nothing behind', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-readonly');
		await readOnlyTree(join(checkout, 'stuck'));

		await repo.invoke('repositories.archive-workstream', { workstreamId: 'ws-readonly' });

		expect(getWorkstream(repo.db, 'ws-readonly')).toBeNull();
		expect(existsSync(checkout)).toBe(false);
		await vi.waitFor(async () => expect(await trashEntries(repo)).toEqual([]), { timeout: 5_000 });
		expect(
			await realGit(repo.base, [
				'show',
				'refs/malini/archived/ws-readonly:stuck/pkg/mod/module.go',
			]),
		).toBe('package mod\n');
	});

	it('stays archived when clearing the checkout fails, and the next start sweeps it', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-stuck');
		const prune = holdGit('prune');
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		cleanups.push(async () => error.mockRestore());

		await repo.invoke('repositories.archive-workstream', { workstreamId: 'ws-stuck' });
		await prune.reached;
		await chmod(checkoutTrashRoot(repo.dir), 0o555);
		prune.release();

		expect(getWorkstream(repo.db, 'ws-stuck')).toBeNull();
		expect(existsSync(checkout)).toBe(false);
		const [left] = await trashEntries(repo);
		expect(left).toMatch(/^ws-stuck-\d+$/);
		await archivedLeftoversCleared();
		expect(await trashEntries(repo)).toEqual([left]);
		expect(error).toHaveBeenCalledWith(
			expect.stringContaining('`ws-stuck` stays in the trash until the next start'),
		);

		await chmod(checkoutTrashRoot(repo.dir), 0o755);
		await repo.restart();

		await vi.waitFor(async () => expect(await trashEntries(repo)).toEqual([]), { timeout: 5_000 });
		expect(getWorkstream(repo.db, 'ws-stuck')).toBeNull();
		expect(await realGit(repo.base, ['worktree', 'list', '--porcelain'])).not.toContain('ws-stuck');
	});

	it('clears a read-only tree left in the trash on the next start', async () => {
		const repo = await harness();
		await readOnlyTree(join(checkoutTrashRoot(repo.dir), 'ws-old-1790000000000', 'stuck'));

		await repo.restart();

		await vi.waitFor(async () => expect(await trashEntries(repo)).toEqual([]), { timeout: 5_000 });
	});

	it('moves a live workstream checkout found in the trash back instead of deleting it', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-stranded');
		await mkdir(checkoutTrashRoot(repo.dir), { recursive: true });
		await rename(checkout, join(checkoutTrashRoot(repo.dir), 'ws-stranded-1790000000000'));
		const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		cleanups.push(async () => warned.mockRestore());

		await repo.restart();

		expect(await trashEntries(repo)).toEqual([]);
		expect(getWorkstream(repo.db, 'ws-stranded')).not.toBeNull();
		expect(await isIntactCheckout(checkout, 'ws-stranded')).toBe(true);
	});

	it('keeps a trashed copy of a live workstream that already has its checkout', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-twice');
		const copy = join(checkoutTrashRoot(repo.dir), 'ws-twice-1790000000000');
		await mkdir(copy, { recursive: true });
		await writeFile(join(copy, 'only-here.txt'), 'only here\n');
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		cleanups.push(async () => error.mockRestore());

		await repo.restart();
		await archivedLeftoversCleared();

		expect(await trashEntries(repo)).toEqual(['ws-twice-1790000000000']);
		expect(await isIntactCheckout(checkout, 'ws-twice')).toBe(true);
		expect(error).toHaveBeenCalledWith(
			expect.stringContaining('its workstream is live and already has a checkout'),
		);
	});
});

async function branchExists(repo: Harness, branch: string): Promise<boolean> {
	return (await realGit(repo.base, ['branch', '--list', branch])).trim().length > 0;
}

async function archivedRef(repo: Harness, workstreamId: string): Promise<string | null> {
	try {
		return (
			await realGit(repo.base, ['rev-parse', '--verify', `refs/malini/archived/${workstreamId}`])
		).trim();
	} catch {
		return null;
	}
}

async function commitIn(checkout: string, file: string): Promise<string> {
	await realGit(checkout, ['config', 'user.email', 't@example.com']);
	await realGit(checkout, ['config', 'user.name', 't']);
	await writeFile(join(checkout, file), `${file}\n`);
	await realGit(checkout, ['add', file]);
	await realGit(checkout, ['commit', '-q', '-m', `add ${file}`]);
	return (await realGit(checkout, ['rev-parse', 'HEAD'])).trim();
}

describe('what archiving keeps of a workstream branch', () => {
	it('deletes a branch that holds nothing of its own, and saves nothing', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-clean');
		await realGit(checkout, ['checkout', '-q', '--', '.']);
		await rm(join(checkout, 'uncommitted.txt'));

		const receipt = await repo.invoke('repositories.archive-workstream', {
			workstreamId: 'ws-clean',
		});

		expect(receipt).toEqual({ savedWork: null });
		await vi.waitFor(async () => expect(await branchExists(repo, 'malini/ws-clean')).toBe(false));
		expect(await archivedRef(repo, 'ws-clean')).toBeNull();
	});

	it('keeps commits that are not on the base in a hidden ref and deletes the branch', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-commits');
		await rm(join(checkout, 'uncommitted.txt'));
		const unpushed = await commitIn(checkout, 'feature.txt');

		const receipt = await repo.invoke('repositories.archive-workstream', {
			workstreamId: 'ws-commits',
		});

		expect(receipt).toEqual({
			savedWork: { ref: 'refs/malini/archived/ws-commits', uncommitted: false, commits: 1 },
		});
		expect(await archivedRef(repo, 'ws-commits')).toBe(unpushed);
		await vi.waitFor(async () => expect(await branchExists(repo, 'malini/ws-commits')).toBe(false));
		expect(await realGit(repo.base, ['branch', '--all'])).not.toContain('archived');
		await realGit(repo.base, ['gc', '-q', '--prune=now']);
		expect(await realGit(repo.base, ['show', `${unpushed}:feature.txt`])).toBe('feature.txt\n');
	});

	it('saves uncommitted and untracked files in a work-in-progress commit on the branch head', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-wip');
		const head = (await realGit(checkout, ['rev-parse', 'HEAD'])).trim();
		await writeFile(join(checkout, 'seed.txt'), 'seed\nedited\n');
		await writeFile(join(checkout, '.gitignore'), 'ignored.log\n');
		await writeFile(join(checkout, 'ignored.log'), 'noise\n');
		await mkdir(join(checkout, '.malini', 'sandbox'), { recursive: true });
		await writeFile(join(checkout, '.malini', 'sandbox', 'scratch.txt'), 'scratch\n');

		const receipt = await repo.invoke('repositories.archive-workstream', {
			workstreamId: 'ws-wip',
		});

		expect(receipt).toEqual({
			savedWork: { ref: 'refs/malini/archived/ws-wip', uncommitted: true, commits: 0 },
		});
		const saved = await archivedRef(repo, 'ws-wip');
		expect(saved).not.toBeNull();
		expect((await realGit(repo.base, ['rev-parse', `${saved}^`])).trim()).toBe(head);
		expect(await realGit(repo.base, ['show', `${saved}:uncommitted.txt`])).toBe(
			'work in progress\n',
		);
		expect(await realGit(repo.base, ['show', `${saved}:seed.txt`])).toBe('seed\nedited\n');
		await expect(realGit(repo.base, ['show', `${saved}:ignored.log`])).rejects.toThrow();
		await expect(
			realGit(repo.base, ['show', `${saved}:.malini/sandbox/scratch.txt`]),
		).rejects.toThrow();
		await vi.waitFor(async () => expect(await branchExists(repo, 'malini/ws-wip')).toBe(false));
	});

	it('leaves the checkout, the branch and the row intact when the work cannot be saved', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-unsaved');
		const before = await realGit(checkout, ['status', '--porcelain']);
		await execFileAsync('chmod', ['-R', 'a-w', join(repo.base, '.git', 'objects')]);

		await expect(
			repo.invoke('repositories.archive-workstream', { workstreamId: 'ws-unsaved' }),
		).rejects.toThrow(
			/^Saving its local work failed \(permission denied\), so nothing was removed$/,
		);

		const [record] = await repo.diagnostics();
		expect(record).toMatchObject({
			source: 'ipc-command',
			command: 'repositories.archive-workstream',
			workstreamId: 'ws-unsaved',
			message: 'Saving its local work failed (permission denied), so nothing was removed',
		});
		expect(JSON.stringify(record?.['error'])).toMatch(
			/caused by: Error: git .+ exited with code \d+\\n.*insufficient permission/u,
		);
		await execFileAsync('chmod', ['-R', 'u+w', join(repo.base, '.git', 'objects')]);
		expect(getWorkstream(repo.db, 'ws-unsaved')).not.toBeNull();
		expect(await isIntactCheckout(checkout, 'ws-unsaved')).toBe(true);
		expect(await realGit(checkout, ['status', '--porcelain'])).toBe(before);
		expect(await branchExists(repo, 'malini/ws-unsaved')).toBe(true);
		expect(await archivedRef(repo, 'ws-unsaved')).toBeNull();
	});

	it('sweeps orphan workstream branches at start, keeping their work and every live branch', async () => {
		const repo = await harness();
		const live = await createWorkstream(repo, 'ws-live');
		await execFileAsync('rm', ['-rf', live]);
		await realGit(repo.base, ['worktree', 'prune']);
		await realGit(repo.base, ['branch', 'malini/ws-orphan', 'origin/main']);
		await realGit(repo.base, ['branch', 'agentic/ws-legacy', 'origin/main']);
		await realGit(repo.base, ['branch', 'malini/ws-orphan-work', 'origin/main']);
		const scratch = join(repo.dir, 'orphan-work');
		await realGit(repo.base, ['worktree', 'add', '-q', scratch, 'malini/ws-orphan-work']);
		const orphanWork = await commitIn(scratch, 'orphan.txt');
		await realGit(repo.base, ['worktree', 'remove', '--force', scratch]);

		await repo.restart();

		await vi.waitFor(
			async () => {
				expect(await branchExists(repo, 'malini/ws-orphan')).toBe(false);
				expect(await branchExists(repo, 'agentic/ws-legacy')).toBe(false);
				expect(await branchExists(repo, 'malini/ws-orphan-work')).toBe(false);
			},
			{ timeout: 5_000 },
		);
		expect(await archivedRef(repo, 'ws-orphan')).toBeNull();
		expect(await archivedRef(repo, 'ws-orphan-work')).toBe(orphanWork);
		expect(await branchExists(repo, 'malini/ws-live')).toBe(true);
		expect(await branchExists(repo, 'malini/ws-seed')).toBe(true);
		expect(getWorkstream(repo.db, 'ws-live')).not.toBeNull();
	});
});

async function commitFile(dir: string, file: string, content: string): Promise<string> {
	await writeFile(join(dir, file), content);
	await realGit(dir, ['add', file]);
	await realGit(dir, ['commit', '-q', '-m', `change ${file}`]);
	return (await realGit(dir, ['rev-parse', 'HEAD'])).trim();
}

async function keeps(repo: Harness, ref: string, commit: string): Promise<boolean> {
	try {
		await realGit(repo.base, ['merge-base', '--is-ancestor', commit, ref]);
		return true;
	} catch {
		return false;
	}
}

async function archiveReceipt(repo: Harness, workstreamId: string): Promise<unknown> {
	return repo.invoke('repositories.archive-workstream', { workstreamId });
}

async function expectSurvivesGc(repo: Harness, commit: string, file: string): Promise<void> {
	await realGit(repo.base, ['reflog', 'expire', '--expire=now', '--all']);
	await realGit(repo.base, ['gc', '-q', '--prune=now']);
	await expect(realGit(repo.base, ['cat-file', '-e', `${commit}:${file}`])).resolves.toBe('');
}

describe('archiving keeps every commit the branch holds, wherever the checkout points', () => {
	it('keeps the branch commits when the checkout is on a detached HEAD', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-detached');
		await commitIn(checkout, 'one.txt');
		const tip = await commitIn(checkout, 'two.txt');
		await realGit(checkout, ['checkout', '-q', '--detach', 'origin/main']);

		const receipt = await archiveReceipt(repo, 'ws-detached');

		expect(receipt).toEqual({
			savedWork: { ref: 'refs/malini/archived/ws-detached', uncommitted: true, commits: 2 },
		});
		expect(await keeps(repo, 'refs/malini/archived/ws-detached', tip)).toBe(true);
		await vi.waitFor(async () =>
			expect(await branchExists(repo, 'malini/ws-detached')).toBe(false),
		);
		await expectSurvivesGc(repo, tip, 'two.txt');
	});

	it('keeps the branch commits and the conflicted files when a rebase stopped midway', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-rebase');
		await commitFile(checkout, 'conflict.txt', 'ours\n');
		const tip = await commitFile(checkout, 'second.txt', 'second\n');
		await commitFile(repo.base, 'conflict.txt', 'theirs\n');
		await realGit(repo.base, ['push', '-q', 'origin', 'main']);
		await realGit(checkout, ['fetch', '-q', 'origin']);
		await expect(realGit(checkout, ['rebase', 'origin/main'])).rejects.toThrow();
		expect((await realGit(checkout, ['status'])).toLowerCase()).toContain('rebase');

		const receipt = await archiveReceipt(repo, 'ws-rebase');

		expect(receipt).toMatchObject({
			savedWork: { ref: 'refs/malini/archived/ws-rebase', uncommitted: true, commits: 2 },
		});
		expect(await keeps(repo, 'refs/malini/archived/ws-rebase', tip)).toBe(true);
		expect(
			await realGit(repo.base, ['show', 'refs/malini/archived/ws-rebase:conflict.txt']),
		).toMatch(/<<<<<<<[\s\S]*theirs[\s\S]*ours/u);
		await vi.waitFor(async () => expect(await branchExists(repo, 'malini/ws-rebase')).toBe(false));
		await expectSurvivesGc(repo, tip, 'second.txt');
	});

	it('keeps both the branch commits and the other branch the checkout switched to', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-switched');
		await rm(join(checkout, 'uncommitted.txt'));
		await commitIn(checkout, 'one.txt');
		const tip = await commitIn(checkout, 'two.txt');
		await realGit(checkout, ['switch', '-q', '-c', 'side', 'origin/main']);
		const side = await commitIn(checkout, 'side.txt');

		const receipt = await archiveReceipt(repo, 'ws-switched');

		expect(receipt).toEqual({
			savedWork: { ref: 'refs/malini/archived/ws-switched', uncommitted: false, commits: 3 },
		});
		expect(await keeps(repo, 'refs/malini/archived/ws-switched', tip)).toBe(true);
		expect(await keeps(repo, 'refs/malini/archived/ws-switched', side)).toBe(true);
		await vi.waitFor(async () =>
			expect(await branchExists(repo, 'malini/ws-switched')).toBe(false),
		);
		await expectSurvivesGc(repo, tip, 'two.txt');
	});

	it('keeps the branch when it gains a commit after its work was saved', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-moved');
		await rm(join(checkout, 'uncommitted.txt'));
		const saved = await commitIn(checkout, 'saved.txt');
		const prune = holdGit('prune');
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		cleanups.push(async () => error.mockRestore());

		await archiveReceipt(repo, 'ws-moved');
		await prune.reached;
		const tree = (await realGit(repo.base, ['rev-parse', `${saved}^{tree}`])).trim();
		const late = (
			await realGit(repo.base, ['commit-tree', tree, '-p', saved, '-m', 'late commit'])
		).trim();
		await realGit(repo.base, ['update-ref', 'refs/heads/malini/ws-moved', late]);
		prune.release();

		await vi.waitFor(() =>
			expect(error).toHaveBeenCalledWith(expect.stringContaining('kept branch `malini/ws-moved`')),
		);
		expect((await realGit(repo.base, ['rev-parse', 'malini/ws-moved'])).trim()).toBe(late);
	});

	it('saves commits that only a remote-tracking ref of the branch holds, which a prune can drop', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-pushed');
		await rm(join(checkout, 'uncommitted.txt'));
		const pushed = await commitIn(checkout, 'pushed.txt');
		await realGit(checkout, ['push', '-q', '-u', 'origin', 'malini/ws-pushed']);

		const receipt = await archiveReceipt(repo, 'ws-pushed');

		expect(receipt).toEqual({
			savedWork: { ref: 'refs/malini/archived/ws-pushed', uncommitted: false, commits: 1 },
		});
		await vi.waitFor(async () => expect(await branchExists(repo, 'malini/ws-pushed')).toBe(false));
		await realGit(repo.base, ['push', '-q', 'origin', '--delete', 'malini/ws-pushed']);
		await realGit(repo.base, ['fetch', '-q', '--prune', 'origin']);
		await expectSurvivesGc(repo, pushed, 'pushed.txt');
	});
});

describe('the snapshot of uncommitted work matches what git itself holds', () => {
	it('keeps a file force-added past .gitignore', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-forced');
		await writeFile(join(checkout, '.gitignore'), 'forced.log\n');
		await writeFile(join(checkout, 'forced.log'), 'kept on purpose\n');
		await realGit(checkout, ['add', '-f', 'forced.log']);

		await archiveReceipt(repo, 'ws-forced');

		expect(await realGit(repo.base, ['show', 'refs/malini/archived/ws-forced:forced.log'])).toBe(
			'kept on purpose\n',
		);
	});

	it('leaves malini-managed files out even when the repository exclude rules were removed', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-managed');
		await writeFile(join(repo.base, '.git', 'info', 'exclude'), '');
		await mkdir(join(checkout, '.malini', 'agent-attachments'), { recursive: true });
		await writeFile(join(checkout, '.malini', 'agent-attachments', 'pasted.png'), 'png\n');
		await mkdir(join(checkout, '.malini', 'sandbox'), { recursive: true });
		await writeFile(join(checkout, '.malini', 'sandbox', 'scratch.txt'), 'scratch\n');

		await archiveReceipt(repo, 'ws-managed');

		const saved = await realGit(repo.base, [
			'ls-tree',
			'-r',
			'--name-only',
			'refs/malini/archived/ws-managed',
		]);
		expect(saved).toContain('uncommitted.txt');
		expect(saved).not.toContain('.malini/');
	});

	it('names the cause when saving fails for a reason it does not recognise', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-corrupt');
		const index = (
			await realGit(checkout, ['rev-parse', '--path-format=absolute', '--git-path', 'index'])
		).trim();
		await writeFile(index, 'x'.repeat(200));

		await expect(archiveReceipt(repo, 'ws-corrupt')).rejects.toThrow(
			/^Saving its local work failed \(bad signature 0x78787878\), so nothing was removed$/,
		);
		expect(getWorkstream(repo.db, 'ws-corrupt')).not.toBeNull();
		expect(existsSync(checkout)).toBe(true);
	});
});

describe('nested repositories and submodules', () => {
	async function nestedRepository(parent: string, path: string): Promise<string> {
		const nested = join(parent, path);
		await mkdir(nested, { recursive: true });
		await realGit(nested, ['init', '-q', '-b', 'main']);
		await realGit(nested, ['config', 'user.email', 't@example.com']);
		await realGit(nested, ['config', 'user.name', 't']);
		return nested;
	}

	async function expectRefused(repo: Harness, workstreamId: string, reason: RegExp): Promise<void> {
		await expect(archiveReceipt(repo, workstreamId)).rejects.toThrow(reason);
		expect(getWorkstream(repo.db, workstreamId)).not.toBeNull();
		expect(await isIntactCheckout(workstreamPathOf(repo, workstreamId), workstreamId)).toBe(true);
		expect(await branchExists(repo, `malini/${workstreamId}`)).toBe(true);
		expect(await archivedRef(repo, workstreamId)).toBeNull();
	}

	function workstreamPathOf(repo: Harness, workstreamId: string): string {
		return join(repo.dir, 'workstreams', workstreamId);
	}

	it('refuses to archive when a nested repository has uncommitted changes', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-nested-dirty');
		const nested = await nestedRepository(checkout, join('vendor', 'lib'));
		await writeFile(join(nested, 'draft.txt'), 'not committed anywhere\n');

		await expectRefused(
			repo,
			'ws-nested-dirty',
			/^The nested repository vendor\/lib has uncommitted changes, so nothing was removed$/,
		);
	});

	it('refuses to archive when a nested repository has commits on no remote', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-nested-commits');
		const nested = await nestedRepository(checkout, 'tool');
		await commitFile(nested, 'tool.txt', 'only here\n');

		await expectRefused(
			repo,
			'ws-nested-commits',
			/^The nested repository tool has commits that are on no remote, so nothing was removed$/,
		);
	});

	it('refuses to archive when a submodule has uncommitted changes', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-submodule');
		await realGit(checkout, [
			'-c',
			'protocol.file.allow=always',
			'submodule',
			'add',
			'-q',
			join(repo.dir, 'remote.git'),
			'sub',
		]);
		await writeFile(join(checkout, 'sub', 'seed.txt'), 'edited inside the submodule\n');

		await expectRefused(
			repo,
			'ws-submodule',
			/^The nested repository sub has uncommitted changes, so nothing was removed$/,
		);
	});

	it('archives past an empty nested repository that holds no work', async () => {
		const repo = await harness();
		const checkout = await createWorkstream(repo, 'ws-nested-empty');
		await nestedRepository(checkout, 'empty');

		await archiveReceipt(repo, 'ws-nested-empty');

		expect(getWorkstream(repo.db, 'ws-nested-empty')).toBeNull();
		expect(
			await realGit(repo.base, ['show', 'refs/malini/archived/ws-nested-empty:uncommitted.txt']),
		).toBe('work in progress\n');
	});
});
