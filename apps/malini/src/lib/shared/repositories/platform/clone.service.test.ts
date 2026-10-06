import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
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
			'GitHub needs you to sign in. Run `gh auth login` and try again.',
		);
		await expect(syncRemoteBase('/base', 'main', 'ghs_x', noPromptCredentialEnv)).rejects.toThrow(
			'GitHub rejected the credentials. Run `gh auth login` and try again.',
		);
	});
});
