import { existsSync } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	classifyCloneError,
	cleanupCreatedBaseClone,
	ensureBaseClone,
	ensureBaseCloneWithOutcome,
	type Progress,
} from './clone.service';
import { noPromptCredentialEnv, type GitCredentialEnv } from '$main/git/credentials';
import { syncRemoteBase } from '$main/git/remote';
import { initRealRepo, realGit, removeDir, tempDir } from '$main/git/fixtures.test-support';
import { repositoryBaseDir } from '$main/git/paths';
import { GitError } from '$main/errors';
import { installGitRunnerForTests } from '$main/git/run';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	while (cleanups.length > 0) await cleanups.pop()?.();
});

async function seedRemote(dir: string): Promise<string> {
	const source = join(dir, 'source');
	await initRealRepo(source);
	await realGit(source, ['branch', '-M', 'main']);
	return source;
}

describe('ensureBaseClone', () => {
	it('t9 clones into repositories/<id>/base and emits progress in order', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const source = await seedRemote(dir);
		const appData = join(dir, 'app-data');
		const events: Progress[] = [];

		const path = await ensureBaseClone({
			repoPath: source,
			appDataRoot: appData,
			githubToken: null,
			credentials: noPromptCredentialEnv,
			onProgress: (progress) => events.push(progress),
		});

		expect(path).toBe(repositoryBaseDir(appData, 'source'));
		expect(existsSync(join(path, 'seed.txt'))).toBe(true);
		expect(events[0]).toEqual({ stage: 'fetch', fraction: 0.05 });
		expect(events.at(-1)).toEqual({ stage: 'done', fraction: 1 });
		expect(events.some((event) => event.stage === 'checkout')).toBe(true);
	});

	it('reuses an existing base and reports it as pre-existing', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const source = await seedRemote(dir);
		const appData = join(dir, 'app-data');
		const input = {
			repoPath: source,
			appDataRoot: appData,
			githubToken: null,
			credentials: noPromptCredentialEnv,
			onProgress: () => undefined,
		};
		const first = await ensureBaseCloneWithOutcome(input);
		expect(first.baseDirExistedBeforeClone).toBe(false);
		const second = await ensureBaseCloneWithOutcome(input);
		expect(second.path).toBe(first.path);
		expect(second.baseDirExistedBeforeClone).toBe(true);
		await cleanupCreatedBaseClone(second);
		expect(existsSync(first.path)).toBe(true);
		await cleanupCreatedBaseClone(first);
		expect(existsSync(first.repoDir)).toBe(false);
	});

	it('t9c hands the credential environment to the clone', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const appData = join(dir, 'app-data');
		const seen: Array<{ args: string[]; env: Record<string, string> }> = [];
		const restore = installGitRunnerForTests(async (args, env) => {
			seen.push({ args: [...args], env: { ...env } });
			await mkdir(join(args[args.length - 1] ?? '', '.git'), { recursive: true });
			return '';
		});
		cleanups.push(async () => restore());
		const credentials: GitCredentialEnv = {
			prepare: async (token) => ({ GIT_TERMINAL_PROMPT: '0', MALINI_TEST_TOKEN: token ?? 'none' }),
		};
		await ensureBaseClone({
			repoPath: 'https://example.com/acme/repo-token.git',
			appDataRoot: appData,
			githubToken: '  ghs_live  ',
			credentials,
			onProgress: () => undefined,
		});
		expect(seen).toHaveLength(1);
		expect(seen[0]?.args.slice(0, 8)).toEqual([
			'-c',
			'credential.helper=',
			'-c',
			'credential.helper=!gh auth git-credential',
			'-c',
			'core.hooksPath=/dev/null',
			'clone',
			'--progress',
		]);
		expect(seen[0]?.args).not.toContain('ghs_live');
		expect(seen[0]?.env).toEqual({ GIT_TERMINAL_PROMPT: '0', MALINI_TEST_TOKEN: 'ghs_live' });
	});

	it('t9d cleans the partial repository directory on a failed clone', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const appData = join(dir, 'app-data');
		await expect(
			ensureBaseClone({
				repoPath: join(dir, 'does-not-exist'),
				appDataRoot: appData,
				githubToken: null,
				credentials: noPromptCredentialEnv,
				onProgress: () => undefined,
			}),
		).rejects.toMatchObject({ kind: 'git' });
		expect(existsSync(join(appData, 'repositories', 'does-not-exist'))).toBe(false);
	});

	it('t9e removes only the base it created when the repo dir pre-existed', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const appData = join(dir, 'app-data');
		const repoDir = join(appData, 'repositories', 'does-not-exist');
		await mkdir(repoDir, { recursive: true });
		await writeFile(join(repoDir, 'keep.txt'), 'keep');
		await expect(
			ensureBaseClone({
				repoPath: join(dir, 'does-not-exist'),
				appDataRoot: appData,
				githubToken: null,
				credentials: noPromptCredentialEnv,
				onProgress: () => undefined,
			}),
		).rejects.toMatchObject({ kind: 'git' });
		expect(existsSync(join(repoDir, 'keep.txt'))).toBe(true);
		expect(existsSync(join(repoDir, 'base'))).toBe(false);
	});

	it('classifies "already exists" as not-a-repo and leaves the rest alone', () => {
		expect(
			classifyCloneError(GitError.git("fatal: destination path 'x' already exists")).kind,
		).toBe('not-a-repo');
		expect(classifyCloneError(GitError.git('boom')).kind).toBe('git');
	});

	it('clones from the local folder, shares its packs, and ends up exactly where the remote is', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const remote = await seedRemote(dir);
		const folder = join(dir, 'folder');
		await realGit(dir, ['clone', '-q', remote, folder]);
		await realGit(folder, ['config', 'user.email', 't@example.com']);
		await realGit(folder, ['config', 'user.name', 't']);
		await writeFile(join(folder, 'unpushed.txt'), 'local only\n');
		await realGit(folder, ['add', '.']);
		await realGit(folder, ['commit', '-q', '-m', 'unpushed']);
		await realGit(folder, ['tag', 'local-tag']);
		await realGit(folder, ['checkout', '-q', '-b', 'feature']);
		await realGit(folder, ['repack', '-a', '-d', '-q']);
		await writeFile(join(remote, 'later.txt'), 'later\n');
		await realGit(remote, ['add', '.']);
		await realGit(remote, ['commit', '-q', '-m', 'later']);
		const remoteTip = (await realGit(remote, ['rev-parse', 'HEAD'])).trim();

		const { path } = await ensureBaseCloneWithOutcome({
			repoPath: remote,
			appDataRoot: join(dir, 'app-data'),
			githubToken: null,
			credentials: noPromptCredentialEnv,
			onProgress: () => undefined,
			seed: { folder, branch: 'main' },
		});

		expect((await realGit(path, ['remote', 'get-url', 'origin'])).trim()).toBe(remote);
		expect((await realGit(path, ['rev-parse', 'HEAD', 'origin/main'])).trim().split('\n')).toEqual([
			remoteTip,
			remoteTip,
		]);
		expect((await realGit(path, ['branch', '--format=%(refname:short)'])).trim()).toBe('main');
		expect((await realGit(path, ['tag', '--list'])).trim()).toBe('');
		expect(existsSync(join(path, 'later.txt'))).toBe(true);
		expect(existsSync(join(path, 'unpushed.txt'))).toBe(false);
		const packs = join(path, '.git', 'objects', 'pack');
		const shared = (await readdir(packs)).filter((name) => name.endsWith('.pack'));
		expect(shared.length).toBeGreaterThan(0);
		for (const pack of shared) {
			expect((await stat(join(packs, pack))).nlink).toBeGreaterThan(1);
			expect(existsSync(join(packs, pack.replace(/\.pack$/u, '.keep')))).toBe(true);
		}
	});

	it('fails without a second clone when the remote the folder points at cannot be reached', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const remote = await seedRemote(dir);
		const folder = join(dir, 'folder');
		await realGit(dir, ['clone', '-q', remote, folder]);
		const clones: string[][] = [];
		const restore = installGitRunnerForTests(async (args, env, previous) => {
			if (args.includes('clone')) clones.push([...args]);
			return previous(args, env);
		});
		cleanups.push(async () => restore());
		const appData = join(dir, 'app-data');

		await expect(
			ensureBaseCloneWithOutcome({
				repoPath: join(dir, 'gone.git'),
				appDataRoot: appData,
				githubToken: null,
				credentials: noPromptCredentialEnv,
				onProgress: () => undefined,
				seed: { folder, branch: 'main' },
			}),
		).rejects.toMatchObject({ kind: 'git' });
		expect(clones).toHaveLength(1);
		expect(existsSync(join(appData, 'repositories', 'gone'))).toBe(false);
	});

	it('clones from the remote when the local folder is a shallow clone', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const remote = await seedRemote(dir);
		const folder = join(dir, 'folder');
		await realGit(dir, ['clone', '-q', '--depth', '1', `file://${remote}`, folder]);

		const { path } = await ensureBaseCloneWithOutcome({
			repoPath: remote,
			appDataRoot: join(dir, 'app-data'),
			githubToken: null,
			credentials: noPromptCredentialEnv,
			onProgress: () => undefined,
			seed: { folder, branch: 'main' },
		});

		expect((await realGit(path, ['rev-parse', '--is-shallow-repository'])).trim()).toBe('false');
		expect(existsSync(join(path, 'seed.txt'))).toBe(true);
	});

	it('clones blobless with GitHub sign-in kept for the blobs it fetches later', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const remote = await seedRemote(dir);
		await realGit(remote, ['config', 'uploadpack.allowFilter', 'true']);

		const { path } = await ensureBaseCloneWithOutcome({
			repoPath: `file://${remote}`,
			appDataRoot: join(dir, 'app-data'),
			githubToken: null,
			credentials: noPromptCredentialEnv,
			onProgress: () => undefined,
			blobless: true,
		});

		expect((await realGit(path, ['config', 'remote.origin.partialclonefilter'])).trim()).toBe(
			'blob:none',
		);
		expect(
			(
				await realGit(path, [
					'config',
					'--local',
					'--get-all',
					'credential.https://github.com.helper',
				])
			).split('\n'),
		).toEqual(['', '!gh auth git-credential', '']);
		expect(existsSync(join(path, 'seed.txt'))).toBe(true);
	});
});

describe('syncRemoteBase', () => {
	it('t7b fetches exactly the base branch into the remote-tracking ref', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		const source = await seedRemote(dir);
		const base = join(dir, 'base');
		await realGit(dir, ['clone', '-q', source, base]);
		await writeFile(join(source, 'later.txt'), 'later\n');
		await realGit(source, ['add', '.']);
		await realGit(source, ['commit', '-q', '-m', 'later']);
		const tip = (await realGit(source, ['rev-parse', 'HEAD'])).trim();

		const ref = await syncRemoteBase(base, 'main', null, noPromptCredentialEnv);
		expect(ref).toBe('refs/remotes/origin/main');
		expect((await realGit(base, ['rev-parse', ref])).trim()).toBe(tip);
		expect((await realGit(base, ['rev-parse', 'main'])).trim()).not.toBe(tip);
	});

	it('t7c rejects an unsafe branch before running git', async () => {
		const restore = installGitRunnerForTests(async () => {
			throw new Error('git must not run');
		});
		cleanups.push(async () => restore());
		await expect(syncRemoteBase('/base', 'a..b', null, noPromptCredentialEnv)).rejects.toThrow(
			'unsafe path: invalid base branch `a..b`',
		);
	});

	it('attributes an auth failure to the token it did or did not send', async () => {
		const restore = installGitRunnerForTests(async (args) => {
			if (args.includes('fetch')) {
				throw GitError.authFailed("could not read Username for 'https://github.com'");
			}
			return '';
		});
		cleanups.push(async () => restore());
		await expect(syncRemoteBase('/base', 'main', null, noPromptCredentialEnv)).rejects.toThrow(
			'GitHub needs you to sign in. Sign in to GitHub in Settings, then try again.',
		);
		await expect(syncRemoteBase('/base', 'main', 'ghs_x', noPromptCredentialEnv)).rejects.toThrow(
			'GitHub rejected the sign-in. Sign in to GitHub again in Settings, then try again.',
		);
	});
});
