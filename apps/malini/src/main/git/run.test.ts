import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initRealRepo, realGit, removeDir, tempDir } from './fixtures.test-support';
import { attributeCredentials, GitError, gitMissingMessage, isNotFoundError } from '$main/errors';
import { installGitRunnerForTests, runGit, runGitBoundedStdout } from './run';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	while (cleanups.length > 0) await cleanups.pop()?.();
});

describe('attributeCredentials', () => {
	const failure = () => GitError.authFailed("could not read Username for 'https://github.com'");

	it('tells a rejected token apart from a missing one', () => {
		expect(attributeCredentials(failure(), 'ghs_live').message).toBe(
			'GitHub rejected the sign-in. Sign in to GitHub again in Settings, then try again.',
		);
		expect(attributeCredentials(failure(), null).message).toBe(
			'GitHub needs you to sign in. Sign in to GitHub in Settings, then try again.',
		);
		expect(attributeCredentials(failure(), '   ').credentials).toBe('none');
	});

	it('leaves every other failure alone', () => {
		expect(attributeCredentials(GitError.notARepo(), 'ghs_live').message).toBe(
			'not a git repository',
		);
	});

	it('never repeats the token back', () => {
		const rendered = attributeCredentials(
			GitError.authFailed("Authentication failed for 'https://github.com/acme/private.git/'"),
			'ghs_secret_value',
		).message;
		expect(rendered).not.toContain('ghs_secret_value');
	});
});

describe('GitError', () => {
	it('renders each kind with its own message', () => {
		expect(GitError.unsafePath('x').message).toBe('unsafe path: x');
		expect(GitError.branchExists('malini/ws').message).toBe('branch already exists: malini/ws');
		expect(GitError.worktreeBusy('locked').message).toBe('worktree busy: locked');
		expect(GitError.outputTooLarge('patch', 10).message).toBe(
			'patch output is over 10 bytes, too large to read safely',
		);
		expect(GitError.gitUnavailable('nope')).toMatchObject({
			message: gitMissingMessage(),
			detail: 'nope',
		});
		expect(GitError.git('boom').message).toBe('git error: boom');
		expect(GitError.io('gone', 'ENOENT').message).toBe('io error: gone');
		expect(isNotFoundError(GitError.io('gone', 'ENOENT'))).toBe(true);
		expect(isNotFoundError(GitError.io('busy', 'ENOTEMPTY'))).toBe(false);
	});
});

describe('runGit', () => {
	it('runs a real git command and returns stdout', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		await initRealRepo(dir);
		expect((await runGit(['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toMatch(
			/^(main|master)$/,
		);
	});

	it('reads status without rewriting the index, so a commit beside it never meets index.lock', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		await initRealRepo(dir);
		const later = new Date(Date.now() + 60_000);
		await utimes(join(dir, 'seed.txt'), later, later);
		const index = await readFile(join(dir, '.git', 'index'));
		await runGit(['-C', dir, 'status', '--porcelain']);
		expect(await readFile(join(dir, '.git', 'index'))).toEqual(index);
	});

	it('calls a checkout whose .git went away mid-delete missing, however git words it', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		await runGit(['init', '--bare', dir]);

		await expect(runGit(['-C', dir, 'status', '--porcelain'])).rejects.toMatchObject({
			kind: 'io',
			code: 'ENOENT',
			message: expect.stringMatching(/^The folder .+ is missing\.$/u),
		});
	});

	it('turns a non-zero exit into what git said, keeping argv and the exit code as its cause', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		await initRealRepo(dir);
		const failure = await runGit(['-C', dir, 'rev-parse', '--verify', 'nowhere']).catch(
			(error: unknown) => error,
		);
		expect(failure).toMatchObject({
			kind: 'git',
			exitCode: 128,
			message: 'Needed a single revision',
			cause: {
				message: expect.stringMatching(
					/^git -C .* rev-parse --verify nowhere exited with code 128\nfatal: Needed a single revision/,
				),
			},
		});
	});

	it('reports a missing git binary as unavailable', async () => {
		const restore = installGitRunnerForTests(() =>
			Promise.reject(GitError.gitUnavailable('git binary not found in PATH')),
		);
		cleanups.push(async () => restore());
		await expect(runGit(['--version'])).rejects.toMatchObject({ kind: 'git-unavailable' });
	});

	it('classifies an authentication failure and keeps what git said', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		await initRealRepo(dir);
		const remote = createServer((_request, response) => {
			response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="GitHub"' }).end();
		});
		await new Promise<void>((resolve) => remote.listen(0, '127.0.0.1', resolve));
		cleanups.push(() => new Promise((resolve) => remote.close(() => resolve())));
		const address = remote.address();
		if (address === null || typeof address === 'string') throw new Error('the remote has no port');
		await expect(
			runGit(
				[
					'-C',
					dir,
					'ls-remote',
					`http://127.0.0.1:${address.port}/malini-does-not-exist/private-repo.git`,
				],
				{
					GIT_TERMINAL_PROMPT: '0',
					GIT_ASKPASS: '',
					GIT_CONFIG_GLOBAL: '/dev/null',
					GIT_CONFIG_NOSYSTEM: '1',
					GIT_CONFIG_COUNT: '1',
					GIT_CONFIG_KEY_0: 'credential.helper',
					GIT_CONFIG_VALUE_0: '',
				},
			),
		).rejects.toMatchObject({
			kind: 'auth-failed',
			message: 'GitHub rejected the sign-in. Sign in to GitHub again in Settings, then try again.',
			detail: expect.stringContaining('could not read Username'),
		});
	}, 30_000);

	it('runs git again when a config file could not be read, and reports one that never can', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		await initRealRepo(dir);
		const aside = await tempDir();
		cleanups.push(() => removeDir(aside));
		const unreadable = join(aside, 'config-is-a-directory');
		await mkdir(unreadable, { recursive: true });
		const trace = join(aside, 'git-trace.log');

		const failure = await runGit(['-C', dir, 'rev-parse', '--git-dir'], {
			GIT_CONFIG_GLOBAL: unreadable,
			GIT_TRACE: trace,
		}).catch((error: unknown) => error);

		expect(failure).toMatchObject({
			kind: 'git',
			exitCode: 128,
			cause: {
				message: expect.stringContaining(
					'unknown error occurred while reading the configuration files',
				),
			},
		});
		expect((await readFile(trace, 'utf8')).match(/built-in: git rev-parse/gu)).toHaveLength(3);
	});

	it('keeps a repository planted in the checkout from running its own fsmonitor', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		await initRealRepo(dir);
		const marker = join(dir, 'fsmonitor-ran').replaceAll('\\', '/');
		const planted = join(dir, 'planted', '.git');
		await mkdir(join(planted, 'objects'), { recursive: true });
		await mkdir(join(planted, 'refs'), { recursive: true });
		await writeFile(join(planted, 'HEAD'), 'ref: refs/heads/main\n');
		await writeFile(
			join(planted, 'config'),
			`[core]\n\trepositoryformatversion = 0\n\tfsmonitor = "echo ran > ${marker}; false"\n`,
		);
		await realGit(dir, [
			'update-index',
			'--add',
			'--cacheinfo',
			`160000,${'1'.repeat(40)},planted`,
		]);
		await realGit(dir, ['status', '--porcelain']);
		expect(existsSync(marker)).toBe(true);
		await rm(marker);

		await runGit(['-C', dir, 'status', '--porcelain']);
		await runGit(['-C', dir, 'add', '-A']);

		expect(existsSync(marker)).toBe(false);
	});
});

describe('runGitBoundedStdout', () => {
	it('refuses output past the bound instead of buffering it', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		await initRealRepo(dir);
		await expect(
			runGitBoundedStdout(['-C', dir, 'log', '-p'], 4, 'test patch'),
		).rejects.toMatchObject({
			kind: 'output-too-large',
			message: 'test patch output is over 4 bytes, too large to read safely',
		});
	});

	it('returns output under the bound', async () => {
		const dir = await tempDir();
		cleanups.push(() => removeDir(dir));
		await initRealRepo(dir);
		const out = await runGitBoundedStdout(['-C', dir, 'rev-parse', 'HEAD'], 1024, 'head');
		expect(out.trim()).toMatch(/^[0-9a-f]{40}$/);
	});
});
