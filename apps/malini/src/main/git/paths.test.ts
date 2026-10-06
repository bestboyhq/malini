import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initRealRepo, removeDir, tempDir } from './fixtures.test-support';
import {
	acceptedWorkstreamBranchNames,
	assessWorkstreamCheckout,
	canonicalGithubHttpsUrl,
	remoteUrlMatchesCanonicalGithubUrl,
	deriveProjectId,
	isAppManagedGitPath,
	localProjectId,
	pathCanonicalizeDeleteGuard,
	resolveWorkstreamCheckoutCanonical,
	resolveWorkstreamCheckoutCanonicalRecorded,
	validateBaseBranch,
	workstreamBranchName,
	workstreamPath,
} from './paths';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	while (cleanups.length > 0) await cleanups.pop()?.();
});

describe('workstreamBranchName', () => {
	it('prefixes a safe id and refuses anything else', () => {
		expect(workstreamBranchName('ws-1_a')).toBe('malini/ws-1_a');
		expect(() => workstreamBranchName('')).toThrow('unsafe path: empty workstream id');
		expect(() => workstreamBranchName('ws/1')).toThrow(
			'unsafe path: workstream id contains unsafe char `/`: `ws/1`',
		);
		expect(() => workstreamBranchName('..')).toThrow(/unsafe char/);
	});

	it('still accepts the legacy branch an existing checkout was created on', () => {
		expect(acceptedWorkstreamBranchNames('ws-1')).toEqual([
			'malini/ws-1',
			'smack/ws-1',
			'agentic/ws-1',
		]);
		expect(() => acceptedWorkstreamBranchNames('ws/1')).toThrow(/unsafe char/);
	});
});

describe('deriveProjectId', () => {
	it('strips the git suffix and normalizes owner and repo', () => {
		expect(deriveProjectId('https://github.com/foo/bar.git')).toBe('foo__bar');
		expect(deriveProjectId('git@github.com:foo/bar.git/')).toBe('foo__bar');
		expect(deriveProjectId('/local/path/to/repo')).toBe('repo');
		expect(deriveProjectId('https://example.com/repo-progress.git')).toBe('repo-progress');
	});

	it('prefixes a local project id the way existing rows are keyed', () => {
		expect(localProjectId('foo__bar')).toBe('local__foo__bar');
	});
});

describe('canonicalGithubHttpsUrl', () => {
	it('accepts a well-formed full name and refuses the rest', () => {
		expect(canonicalGithubHttpsUrl('acme/repo.name')).toBe('https://github.com/acme/repo.name.git');
		for (const bad of ['acme', 'acme/repo/extra', '-acme/repo', 'acme/..', 'ac me/repo', 'acme/']) {
			expect(() => canonicalGithubHttpsUrl(bad)).toThrow(
				'unsafe path: invalid GitHub repository full name',
			);
		}
	});
});

describe('remoteUrlMatchesCanonicalGithubUrl', () => {
	it('accepts the same GitHub repository over https or ssh and refuses anything else', () => {
		const canonical = canonicalGithubHttpsUrl('acme/repo');
		for (const same of [
			'https://github.com/acme/repo.git',
			'https://github.com/Acme/Repo',
			'git@github.com:acme/repo.git',
			'ssh://git@github.com/acme/repo',
		]) {
			expect(remoteUrlMatchesCanonicalGithubUrl(same, canonical)).toBe(true);
		}
		for (const other of [
			'git@github.com:acme/other.git',
			'git@gitlab.com:acme/repo.git',
			'https://github.com.evil/acme/repo.git',
			'https://github.com/acme/repo/extra.git',
			'ext::sh -c evil',
			'',
		]) {
			expect(remoteUrlMatchesCanonicalGithubUrl(other, canonical)).toBe(false);
		}
	});
});

describe('validateBaseBranch', () => {
	it('lets ordinary names through and refuses refspec tricks', () => {
		expect(() => validateBaseBranch('main')).not.toThrow();
		expect(() => validateBaseBranch('release/2026.09')).not.toThrow();
		for (const bad of [
			'',
			'-x',
			'/x',
			'x/',
			'x.',
			'x.lock',
			'a..b',
			'a//b',
			'a@{1}',
			'a b',
			'a~1',
		]) {
			expect(() => validateBaseBranch(bad)).toThrow(`unsafe path: invalid base branch \`${bad}\``);
		}
	});
});

describe('isAppManagedGitPath', () => {
	it('matches the two transport roots and their descendants only', () => {
		expect(isAppManagedGitPath('.malini/agent-attachments')).toBe(true);
		expect(isAppManagedGitPath('./.malini/agent-attachments/x/y')).toBe(true);
		expect(isAppManagedGitPath('.malini/sandbox/tmp')).toBe(true);
		expect(isAppManagedGitPath('.malini/agent-attachments-not')).toBe(false);
		expect(isAppManagedGitPath('src/.malini/sandbox')).toBe(false);
	});
});

describe('pathCanonicalizeDeleteGuard', () => {
	it('t1 rejects a dotdot segment before touching the disk', () => {
		expect(() => pathCanonicalizeDeleteGuard('/nonexistent/../x', '/nonexistent')).toThrow(
			'contains `..` segment',
		);
		expect(() => pathCanonicalizeDeleteGuard('/nonexistent/./x', '/nonexistent')).toThrow(
			'contains `.` segment',
		);
	});

	it('t2 accepts a valid path under the worktrees root', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const root = join(dir, 'worktrees');
		const wt = join(root, 'ws-1');
		await mkdir(wt, { recursive: true });
		expect(pathCanonicalizeDeleteGuard(wt, root)).toBe(await realpath(wt));
	});

	it('t3/t4 rejects a symlink escaping the root, the root itself, and a foreign path', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const root = join(dir, 'worktrees');
		const outside = join(dir, 'outside');
		await mkdir(root, { recursive: true });
		await mkdir(outside, { recursive: true });
		await symlink(outside, join(root, 'escape'));
		expect(() => pathCanonicalizeDeleteGuard(join(root, 'escape'), root)).toThrow(
			/resolves outside worktrees root/,
		);
		expect(() => pathCanonicalizeDeleteGuard(root, root)).toThrow('refusing to delete root');
		expect(() => pathCanonicalizeDeleteGuard(outside, root)).toThrow(
			/resolves outside worktrees root/,
		);
	});
});

describe('resolveWorkstreamCheckoutCanonicalRecorded', () => {
	it('t4b resolves the workstreams layout', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		await mkdir(join(dir, 'workstreams', 'ws-1'), { recursive: true });
		expect(resolveWorkstreamCheckoutCanonical(dir, 'ws-1')).toBe(
			await realpath(join(dir, 'workstreams', 'ws-1')),
		);
	});

	it('t4b2 adopts the legacy managed directories on the first resolve', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const checkout = join(dir, 'workstreams', 'ws-adopt');
		await mkdir(join(checkout, '.smack', 'agent-attachments', 'att-1'), {
			recursive: true,
		});
		await mkdir(join(checkout, '.core', 'sandbox'), { recursive: true });
		await writeFile(join(checkout, '.smack', 'agent-attachments', 'att-1', 'a.txt'), 'kept');
		await writeFile(join(checkout, '.core', 'sandbox', 'install-complete'), '');

		const resolved = resolveWorkstreamCheckoutCanonical(dir, 'ws-adopt');

		expect(
			await readFile(join(resolved, '.malini', 'agent-attachments', 'att-1', 'a.txt'), 'utf8'),
		).toBe('kept');
		expect(existsSync(join(resolved, '.malini', 'sandbox', 'install-complete'))).toBe(true);
		expect(existsSync(join(resolved, '.smack'))).toBe(false);
		expect(existsSync(join(resolved, '.core'))).toBe(false);
		expect(resolveWorkstreamCheckoutCanonical(dir, 'ws-adopt')).toBe(resolved);
	});

	it('t4d rejects a missing checkout with ENOENT and a traversal id before the disk', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		expect(() => resolveWorkstreamCheckoutCanonical(dir, 'ws-missing')).toThrow(
			expect.objectContaining({
				kind: 'io',
				code: 'ENOENT',
				message: "This workstream's folder is missing.",
				detail: 'repository checkout `ws-missing` not found',
			}),
		);
		expect(() => resolveWorkstreamCheckoutCanonical(dir, '../etc')).toThrow(/unsafe char/);
	});

	it('t4g rescues a checkout the derivation no longer guesses through the recorded path', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const recorded = join(dir, 'workstreams', 'renamed-by-hand');
		await mkdir(recorded, { recursive: true });
		expect(resolveWorkstreamCheckoutCanonicalRecorded(dir, 'ws-1', recorded)).toBe(
			await realpath(recorded),
		);
	});

	it('t4h refuses a recorded path outside the checkout roots', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const elsewhere = join(dir, 'elsewhere');
		await mkdir(elsewhere, { recursive: true });
		expect(() => resolveWorkstreamCheckoutCanonicalRecorded(dir, 'ws-1', elsewhere)).toThrow(
			expect.objectContaining({ code: 'ENOENT', detail: 'repository checkout `ws-1` not found' }),
		);
	});
});

describe('assessWorkstreamCheckout', () => {
	it('t4i names each way the row and the disk disagree', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));

		const healthy = join(dir, 'workstreams', 'ws-ok');
		await initRealRepo(healthy);
		expect(assessWorkstreamCheckout(dir, 'ws-ok', healthy)).toMatchObject({
			state: 'healthy',
			resolvedPath: await realpath(healthy),
			issue: null,
		});

		const diverged = join(dir, 'workstreams', 'ws-diverged');
		await initRealRepo(diverged);
		expect(
			assessWorkstreamCheckout(dir, 'ws-diverged', join(dir, 'worktrees', 'old')),
		).toMatchObject({
			state: 'path-diverged',
			issue: expect.stringContaining('does not exist'),
		});
		expect(assessWorkstreamCheckout(dir, 'ws-diverged', '')).toMatchObject({
			state: 'path-diverged',
			issue: expect.stringContaining('no checkout path is recorded'),
		});

		const leftover = join(dir, 'workstreams', 'ws-leftover');
		await mkdir(leftover, { recursive: true });
		await writeFile(join(leftover, 'stale.txt'), 'x');
		expect(assessWorkstreamCheckout(dir, 'ws-leftover', leftover)).toMatchObject({
			state: 'not-a-checkout',
			issue: expect.stringContaining('has no .git entry'),
		});

		expect(assessWorkstreamCheckout(dir, 'ws-gone', workstreamPath(dir, 'ws-gone'))).toMatchObject({
			state: 'missing',
			resolvedPath: null,
			issue: expect.stringContaining('removed outside the app'),
		});

		expect(assessWorkstreamCheckout(dir, 'bad id', '')).toMatchObject({
			state: 'unresolvable',
			issue: expect.stringContaining('unsafe char'),
		});
	});
});
