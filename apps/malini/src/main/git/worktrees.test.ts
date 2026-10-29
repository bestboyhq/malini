import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
	chmod,
	mkdir,
	readdir,
	readFile,
	realpath,
	stat,
	symlink,
	utimes,
	writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
	initRealRepo,
	realGit,
	removeDir,
	tempDir,
	workstreamFixture,
} from './fixtures.test-support';
import { workstreamBranchName } from './paths';
import { GitError } from '$main/errors';
import { installGitRunnerForTests } from './run';
import {
	addWorktree,
	addWorktreeWithRollback,
	branchList,
	cleanupFailedWorkstream,
	deleteWorkstreamBranch,
	listWorktrees,
	parseWorktreeListPorcelain,
	populateCheckout,
	removeCheckoutDirResilient,
	removeWorktree,
	withProjectLock,
} from './worktrees';

const execFileAsync = promisify(execFile);

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	while (cleanups.length > 0) await cleanups.pop()?.();
});

describe('parseWorktreeListPorcelain', () => {
	it('t4e parses every attribute git can emit', () => {
		const stdout = `worktree /repos/base
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main

worktree /checkouts/detached
HEAD 2222222222222222222222222222222222222222
detached

worktree /checkouts/held
HEAD 3333333333333333333333333333333333333333
branch refs/heads/malini/ws-held
locked because a build is running
prunable gitdir file points to non-existent location

worktree /repos/mirror
bare
`;
		const entries = parseWorktreeListPorcelain(stdout);
		expect(entries).toHaveLength(4);
		expect(entries[0]).toMatchObject({
			path: '/repos/base',
			branch: 'refs/heads/main',
			detached: false,
			bare: false,
		});
		expect(entries[1]).toMatchObject({ detached: true, branch: null });
		expect(entries[2]).toMatchObject({
			locked: true,
			prunable: true,
			branch: 'refs/heads/malini/ws-held',
		});
		expect(entries[3]).toMatchObject({ bare: true, head: null });
	});
});

describe('listWorktrees', () => {
	it('t4f reports exactly what git registered', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const base = join(dir, 'base');
		await initRealRepo(base);
		const checkout = join(dir, 'checkout-one');
		await realGit(base, ['worktree', 'add', '-q', '-b', 'malini/ws-enum', checkout]);

		const entries = await listWorktrees(base);
		expect(entries).toHaveLength(2);
		const linked = entries.find((entry) => entry.branch === 'refs/heads/malini/ws-enum');
		expect(linked).toBeDefined();
		expect(await realpath(linked?.path ?? '')).toBe(await realpath(checkout));
		expect(linked?.prunable).toBe(false);
	});
});

describe('branchList', () => {
	it('t12 returns stripped branch names', async () => {
		const restore = installGitRunnerForTests(async (args) => {
			expect(args).toEqual(expect.arrayContaining(['branch', '--list']));
			return '  main\n  feature/foo\nmalini/ws-abc\n';
		});
		cleanups.push(async () => restore());
		expect(await branchList('/repo')).toEqual(['main', 'feature/foo', 'malini/ws-abc']);
	});
});

describe('addWorktree', () => {
	it('t6 rejects a branch name git would read as an option', async () => {
		await expect(addWorktree('/base', '/wt', '-x', 'main')).rejects.toThrow(
			'unsafe path: invalid branch `-x`',
		);
	});

	it('t10 invokes git with the right argv and creates a real checkout', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const base = join(dir, 'base');
		await initRealRepo(base);
		const wt = join(dir, 'workstreams', 'ws-abc');
		await mkdir(join(dir, 'workstreams'), { recursive: true });
		const trunk = (await realGit(base, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
		await addWorktree(base, wt, workstreamBranchName('ws-abc'), trunk);
		expect(existsSync(join(wt, 'seed.txt'))).toBe(true);
		expect((await realGit(wt, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe('malini/ws-abc');
	});

	it('t7 reports a branch clash as branch-exists', async () => {
		const restore = installGitRunnerForTests(async (args) => {
			if (args.includes('-b')) {
				throw GitError.git("fatal: a branch named 'malini/ws-abc' already exists");
			}
			return '';
		});
		cleanups.push(async () => restore());
		await expect(addWorktree('/base', '/wt', 'malini/ws-abc', 'main')).rejects.toMatchObject({
			kind: 'branch-exists',
			message: 'branch already exists: malini/ws-abc',
		});
	});

	it('t9j does not report a path collision as a branch conflict', async () => {
		const wt = '/data/workstreams/ws-collide';
		const restore = installGitRunnerForTests(async (args) => {
			if (args.includes('worktree') && args.includes('add')) {
				throw GitError.git(`fatal: '${wt}' already exists`);
			}
			return '';
		});
		cleanups.push(async () => restore());
		await expect(addWorktree('/base', wt, 'malini/ws-collide', 'main')).rejects.toMatchObject({
			kind: 'git',
			message: expect.stringContaining('ws-collide'),
		});
	});

	it('clones what the base checkout shares with the new commit and writes only the rest', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const base = join(dir, 'base');
		await initRealRepo(base);
		const trunk = (await realGit(base, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
		await mkdir(join(base, 'src'), { recursive: true });
		await writeFile(join(base, '.gitignore'), 'node_modules/\njunk/\n');
		await writeFile(join(base, 'src', 'kept.txt'), 'kept\n');
		await writeFile(join(base, 'src', 'changed.txt'), 'old\n');
		await realGit(base, ['add', '.']);
		await realGit(base, ['commit', '-q', '-m', 'files']);
		await realGit(base, ['checkout', '-q', '-b', 'next']);
		await writeFile(join(base, 'src', 'changed.txt'), 'new\n');
		await realGit(base, ['commit', '-q', '-am', 'next']);
		await realGit(base, ['checkout', '-q', trunk]);
		const longAgo = new Date('2001-01-01T00:00:00Z');
		await utimes(join(base, 'src', 'kept.txt'), longAgo, longAgo);
		await writeFile(join(base, 'seed.txt'), 'edited in the base\n');
		await writeFile(join(base, 'src', 'untracked.txt'), 'untracked\n');
		await mkdir(join(base, 'src', 'node_modules', 'pkg'), { recursive: true });
		await writeFile(join(base, 'src', 'node_modules', 'pkg', 'index.js'), 'ignored\n');
		await mkdir(join(base, 'junk'), { recursive: true });
		await writeFile(join(base, 'junk', 'big.bin'), 'ignored\n');

		const wt = join(dir, 'workstreams', 'ws-cow');
		await mkdir(join(dir, 'workstreams'), { recursive: true });
		await addWorktree(base, wt, workstreamBranchName('ws-cow'), 'next');

		expect((await stat(join(wt, 'src', 'kept.txt'))).mtime).toEqual(longAgo);
		expect(await readFile(join(wt, 'src', 'changed.txt'), 'utf8')).toBe('new\n');
		expect(await readFile(join(wt, 'seed.txt'), 'utf8')).toBe('seed\n');
		expect(existsSync(join(wt, 'src', 'untracked.txt'))).toBe(false);
		expect(existsSync(join(wt, 'src', 'node_modules'))).toBe(false);
		expect(existsSync(join(wt, 'junk'))).toBe(false);
		expect(await realGit(wt, ['status', '--porcelain', '--ignored'])).toBe('');
	});

	it('fast-forwards the base checkout to its upstream so the next workstream clones current files', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const { base, checkout } = await workstreamFixture(dir, 'ws-pusher');
		await writeFile(join(checkout, 'landed.txt'), 'landed on main\n');
		await realGit(checkout, ['add', '.']);
		await realGit(checkout, ['commit', '-q', '-m', 'landed']);
		await realGit(checkout, ['push', '-q', 'origin', 'HEAD:main']);
		await realGit(base, ['fetch', '-q', 'origin']);

		const wt = join(dir, 'workstreams', 'ws-next');
		await addWorktree(base, wt, workstreamBranchName('ws-next'), 'origin/main');

		expect((await realGit(base, ['rev-parse', 'HEAD'])).trim()).toBe(
			(await realGit(base, ['rev-parse', 'origin/main'])).trim(),
		);
		expect(await readFile(join(base, 'landed.txt'), 'utf8')).toBe('landed on main\n');
		expect(await readFile(join(wt, 'landed.txt'), 'utf8')).toBe('landed on main\n');
		expect(await realGit(wt, ['status', '--porcelain', '--ignored'])).toBe('');
	});

	it('leaves a submodule folder empty even when the base checked it out', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const base = join(dir, 'base');
		await initRealRepo(base);
		const trunk = (await realGit(base, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
		const commit = (await realGit(base, ['rev-parse', 'HEAD'])).trim();
		await writeFile(join(base, '.gitmodules'), '[submodule "lib"]\n\tpath = lib\n\turl = ../lib\n');
		await realGit(base, ['update-index', '--add', '--cacheinfo', `160000,${commit},lib`]);
		await realGit(base, ['add', '.gitmodules']);
		await realGit(base, ['commit', '-q', '-m', 'submodule']);
		await mkdir(join(base, 'lib', '.git'), { recursive: true });
		await writeFile(join(base, 'lib', 'file.txt'), 'submodule content\n');

		const wt = join(dir, 'workstreams', 'ws-sub');
		await mkdir(join(dir, 'workstreams'), { recursive: true });
		await addWorktree(base, wt, workstreamBranchName('ws-sub'), trunk);

		expect(await readdir(join(wt, 'lib'))).toEqual([]);
		expect(await realGit(wt, ['status', '--porcelain'])).toBe('');
	});

	it('refuses to fill a folder that is not a linked worktree', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const base = join(dir, 'base');
		await initRealRepo(base);
		await writeFile(join(base, 'untracked.txt'), 'stays\n');
		await expect(populateCheckout(base, base)).rejects.toMatchObject({ kind: 'unsafe-path' });
		expect(existsSync(join(base, 'untracked.txt'))).toBe(true);
	});
});

describe('addWorktreeWithRollback', () => {
	it('t9k cleans up a path collision so the next attempt can succeed', async () => {
		const calls: string[][] = [];
		const wt = '/data/workstreams/ws-retry';
		const restore = installGitRunnerForTests(async (args) => {
			calls.push([...args]);
			if (args.includes('branch') && args.includes('--list')) return 'main\n';
			if (args.includes('worktree') && args.includes('add')) {
				throw GitError.git(`fatal: '${wt}' already exists`);
			}
			return '';
		});
		cleanups.push(async () => restore());
		await expect(
			addWorktreeWithRollback('/base', wt, 'malini/ws-retry', 'main'),
		).rejects.not.toMatchObject({ kind: 'branch-exists' });
		expect(calls.some((argv) => argv.includes('worktree') && argv.includes('remove'))).toBe(true);
	});

	it('t9h preserves a genuine pre-existing branch conflict without cleaning up', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const base = join(dir, 'base');
		await initRealRepo(base);
		await realGit(base, ['branch', 'malini/ws-taken']);
		const trunk = (await realGit(base, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
		const wt = join(dir, 'workstreams', 'ws-taken');
		await expect(
			addWorktreeWithRollback(base, wt, workstreamBranchName('ws-taken'), trunk),
		).rejects.toMatchObject({ kind: 'branch-exists' });
		expect(await branchList(base)).toContain('malini/ws-taken');
		expect(existsSync(wt)).toBe(false);
	});

	it('t9g rolls a partial checkout and its branch back on a real failure', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const base = join(dir, 'base');
		await initRealRepo(base);
		const wt = join(dir, 'workstreams', 'ws-roll');
		await expect(
			addWorktreeWithRollback(base, wt, workstreamBranchName('ws-roll'), 'no-such-base'),
		).rejects.toMatchObject({ kind: 'git' });
		expect(await branchList(base)).not.toContain('malini/ws-roll');
		expect(existsSync(wt)).toBe(false);
	});
});

describe('removeWorktree and cleanup', () => {
	it('removes a real checkout and refuses a path that does not encode a workstream branch', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const base = join(dir, 'base');
		await initRealRepo(base);
		const wt = join(dir, 'workstreams', 'ws-gone');
		await mkdir(join(dir, 'workstreams'), { recursive: true });
		await realGit(base, ['worktree', 'add', '-q', '-b', 'malini/ws-gone', wt]);
		await removeWorktree(wt);
		expect(existsSync(wt)).toBe(false);
		expect(await listWorktrees(base)).toHaveLength(1);
		await expect(removeWorktree('')).rejects.toThrow(/does not encode a workstream branch/);
	});

	it('t9i cleanupFailedWorkstream removes checkout and branch', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const base = join(dir, 'base');
		await initRealRepo(base);
		const wt = join(dir, 'workstreams', 'ws-clean');
		await mkdir(join(dir, 'workstreams'), { recursive: true });
		await realGit(base, ['worktree', 'add', '-q', '-b', 'malini/ws-clean', wt]);
		await writeFile(join(wt, 'dirty.txt'), 'x');
		expect(await cleanupFailedWorkstream(base, wt, 'malini/ws-clean')).toBeNull();
		expect(existsSync(wt)).toBe(false);
		expect(await branchList(base)).not.toContain('malini/ws-clean');
	});

	it('t9l deletes archived branches while new checkouts track origin without a git lock clash', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const { base } = await workstreamFixture(dir, 'ws-seed');
		const ids = Array.from({ length: 12 }, (_, index) => `ws-${index}`);
		for (const id of ids) {
			await realGit(base, ['branch', '--track', `malini/archived-${id}`, 'origin/main']);
		}
		await Promise.all(
			ids.flatMap((id) => [
				deleteWorkstreamBranch(base, `malini/archived-${id}`),
				addWorktree(base, join(dir, 'workstreams', id), workstreamBranchName(id), 'origin/main'),
			]),
		);
		expect(await branchList(base)).toEqual(
			expect.arrayContaining(ids.map((id) => workstreamBranchName(id))),
		);
		expect(await branchList(base)).not.toContain('malini/archived-ws-0');
	}, 120_000);
});

describe('removeCheckoutDirResilient', () => {
	it('t19a retries until the directory settles', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const target = join(dir, 'checkout');
		await mkdir(target);
		let attempts = 0;
		const failure = await removeCheckoutDirResilient(target, async (path) => {
			attempts += 1;
			if (attempts < 3) {
				throw Object.assign(new Error('Directory not empty'), { code: 'ENOTEMPTY' });
			}
			await removeDir(path);
		});
		expect(failure).toBeNull();
		expect(attempts).toBe(3);
		expect(existsSync(target)).toBe(false);
	});

	it('t19b names the path and the remaining entries when it gives up', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const target = join(dir, 'checkout');
		await mkdir(target);
		for (const name of ['a', 'b', 'c', 'd', 'e']) await writeFile(join(target, name), name);
		const failure = await removeCheckoutDirResilient(target, async () => {
			throw Object.assign(new Error('Directory not empty'), { code: 'ENOTEMPTY' });
		});
		expect(failure).toContain(`could not empty \`${target}\` after 5 attempts`);
		expect(failure).toContain('still present: a, b, c (+2 more)');
		expect(failure).toContain('Stop anything still writing inside the workstream');
	});

	it('t19d removes a read-only nested tree the way rm -rf does', async () => {
		const dir = await tempDir();
		cleanups.push(async () => {
			await execFileAsync('chmod', ['-R', 'u+w', dir]);
			await removeDir(dir);
		});
		const target = join(dir, 'checkout');
		const deep = join(target, 'pkg', 'mod', 'cache');
		await mkdir(deep, { recursive: true });
		await writeFile(join(deep, 'module.go'), 'package cache\n');
		await chmod(join(deep, 'module.go'), 0o444);
		for (const path of [deep, join(target, 'pkg', 'mod'), join(target, 'pkg')]) {
			await chmod(path, 0o555);
		}

		expect(await removeCheckoutDirResilient(target)).toBeNull();
		expect(existsSync(target)).toBe(false);
	});

	it('t19e never loosens anything a symlink inside the tree points to', async () => {
		const dir = await tempDir();
		cleanups.push(async () => {
			await execFileAsync('chmod', ['-R', 'u+w', dir]);
			await removeDir(dir);
		});
		const outside = join(dir, 'outside');
		await mkdir(outside);
		await writeFile(join(outside, 'keep.txt'), 'keep\n');
		await chmod(outside, 0o555);
		const target = join(dir, 'checkout');
		await mkdir(join(target, 'locked'), { recursive: true });
		await symlink(outside, join(target, 'locked', 'link'));
		await chmod(join(target, 'locked'), 0o555);

		expect(await removeCheckoutDirResilient(target)).toBeNull();
		expect(existsSync(target)).toBe(false);
		expect(existsSync(join(outside, 'keep.txt'))).toBe(true);
		expect((await stat(outside)).mode & 0o777).toBe(0o555);
	});

	it('t19c treats a missing directory as removed', async () => {
		expect(await removeCheckoutDirResilient('/nonexistent/malini-checkout')).toBeNull();
	});
});

describe('withProjectLock', () => {
	it('t8 serializes bodies for one project and lets different projects interleave', async () => {
		const order: string[] = [];
		const a1 = withProjectLock('a', async () => {
			order.push('a1 start');
			await new Promise((resolve) => setTimeout(resolve, 30));
			order.push('a1 end');
		});
		const a2 = withProjectLock('a', async () => {
			order.push('a2 start');
		});
		const b = withProjectLock('b', async () => {
			order.push('b start');
		});
		await Promise.all([a1, a2, b]);
		expect(order.indexOf('a1 end')).toBeLessThan(order.indexOf('a2 start'));
		expect(order.indexOf('b start')).toBeLessThan(order.indexOf('a1 end'));
	});
});
