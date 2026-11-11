import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
	ipcMain: { handle: vi.fn() },
	BrowserWindow: { getAllWindows: () => [] },
}));

import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import type { GhResult } from '$main/process/gh';
import { GH_DOWNLOAD_URL } from '$main/process/gh-install';
import {
	defaultGhRunner,
	GH_ANSWER_TIMEOUT_MS,
	githubAuthStatus,
	type GhRunner,
} from './github.service';
import { processIsAlive } from '$main/process/process-group';
import {
	listConnectedRepositories,
	upsertConnectedRepository,
} from './connected-repositories.repository';
import { listHiddenRepositoryIds, setRepositoryHidden } from './hidden-repositories.repository';
import { registerRepositories, type RepositoriesDeps } from './register';
import { GhError } from '$main/errors';
import { githubFullNameFromRemote } from './repository.service';

function ok(stdout: string, code = 0, stderr = ''): GhResult {
	return { stdout, stderr, code };
}

type RunnerCall = { args: readonly string[]; cwd?: string };

function fakeRunner(
	handler: (args: readonly string[], cwd?: string) => GhResult | Promise<GhResult>,
): { run: GhRunner; calls: RunnerCall[] } {
	const calls: RunnerCall[] = [];
	const run: GhRunner = async (args, options) => {
		calls.push(options?.cwd === undefined ? { args } : { args, cwd: options.cwd });
		return handler(args, options?.cwd);
	};
	return { run, calls };
}

let root: string;
let db: MaliniDatabase;
let context: MainContext;
const disposers: Array<() => void> = [];

function boot(deps: RepositoriesDeps = {}): void {
	const platform = registerRepositories(context, { startupReclaim: false, ...deps });
	disposers.push(() => platform.watchers.dispose());
}

async function invoke<T>(command: string, args?: unknown): Promise<T>;
async function invoke(command: string, args: unknown = {}): Promise<unknown> {
	const response = await context.commands.invoke({ command, args });
	if (!response.ok) throw new Error(response.error);
	return response.value;
}

function gitRepoWithRemote(path: string, remote: string): void {
	execFileSync('git', ['init', '-q', '-b', 'main', path]);
	execFileSync('git', ['-C', path, 'config', 'user.email', 't@example.com']);
	execFileSync('git', ['-C', path, 'config', 'user.name', 't']);
	execFileSync('git', ['-C', path, 'remote', 'add', 'origin', remote]);
}

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), 'malini-github-')));
	db = openMigratedDatabase(':memory:');
	context = {
		db,
		commands: new CommandRegistry(),
		events: createEventBus({ forwardToWindows: false }),
		appDataRoot: join(root, 'app-data'),
		checkoutsRoot: join(root, 'app-data'),
		resourcesRoot: root,
		isDev: true,
		appVersion: '0.1.0',
	};
});

afterEach(() => {
	for (const dispose of disposers.splice(0)) dispose();
	db.close();
	rmSync(root, { recursive: true, force: true });
});

describe('githubFullNameFromRemote', () => {
	it('reads owner/name from the remote forms GitHub serves', () => {
		expect(githubFullNameFromRemote('git@github.com:owner/name.git')).toBe('owner/name');
		expect(githubFullNameFromRemote('https://github.com/owner/name.git')).toBe('owner/name');
		expect(githubFullNameFromRemote('https://github.com/owner/name')).toBe('owner/name');
		expect(githubFullNameFromRemote('ssh://git@github.com/owner/name.git')).toBe('owner/name');
	});

	it('rejects non-GitHub and malformed remotes', () => {
		expect(githubFullNameFromRemote('git@gitlab.com:owner/name.git')).toBeNull();
		expect(githubFullNameFromRemote('https://github.com/owner/name/extra')).toBeNull();
		expect(githubFullNameFromRemote('')).toBeNull();
	});
});

describe('repositories.github-auth-status', () => {
	it('reports installed-but-signed-out without throwing', async () => {
		const { run } = fakeRunner(() => ok('', 1, 'You are not logged in to any GitHub hosts.'));
		boot({ ghRunner: run });
		const status = await invoke<{
			authenticated: boolean;
			installed: boolean;
			message: string | null;
		}>('repositories.github-auth-status');
		expect(status.authenticated).toBe(false);
		expect(status.installed).toBe(true);
		expect(status.message).toContain('not logged in');
	});

	it('reports the signed-in account', async () => {
		const { run } = fakeRunner((args) => {
			if (args[0] === 'auth') return ok('Logged in to github.com account szymeo');
			if (args[0] === 'api') return ok('szymeo\n');
			return ok('');
		});
		boot({ ghRunner: run });
		const status = await invoke<{ authenticated: boolean; login: string | null }>(
			'repositories.github-auth-status',
		);
		expect(status.authenticated).toBe(true);
		expect(status.login).toBe('szymeo');
	});

	it('gives gh a time limit for the check, so a hung gh never leaves setup checking', async () => {
		const limits: (number | undefined)[] = [];
		boot({
			ghRunner: async (args, options) => {
				limits.push(options?.timeoutMs);
				return args[0] === 'auth' ? ok('Logged in') : ok('szymeo\n');
			},
		});
		await invoke('repositories.github-auth-status');
		expect(limits).toEqual([GH_ANSWER_TIMEOUT_MS, GH_ANSWER_TIMEOUT_MS]);
	});

	it('reports gh missing while other commands keep working', async () => {
		const run: GhRunner = () => Promise.reject(GhError.notInstalled());
		boot({ ghRunner: run });
		const status = await invoke<{ authenticated: boolean; installed: boolean }>(
			'repositories.github-auth-status',
		);
		expect(status).toMatchObject({ authenticated: false, installed: false });
	});
});

describe('repositories.install-github-cli', () => {
	it('downloads the pinned gh into the app data folder and says why when it cannot', async () => {
		const asked: string[] = [];
		boot({
			ghRunner: fakeRunner(() => ok('')).run,
			downloadGh: async (url) => {
				asked.push(url);
				return new Response('', { status: 503 });
			},
		});
		await expect(invoke('repositories.install-github-cli')).rejects.toThrow(
			'Could not download the GitHub CLI: HTTP 503',
		);
		expect(asked).toEqual([GH_DOWNLOAD_URL]);
		expect(existsSync(join(context.appDataRoot, 'vendor', 'gh'))).toBe(false);
	});
});

describe('repositories.list-github-repositories', () => {
	it('lists the repositories gh reports, most recently pushed first, and skips malformed entries', async () => {
		const { run, calls } = fakeRunner(() =>
			ok(
				JSON.stringify([
					{
						full_name: 'bestboyhq/malini',
						clone_url: 'https://github.com/bestboyhq/malini.git',
						description: '  ADE for the rest of us. ',
						private: true,
						pushed_at: '2026-11-03T09:00:00Z',
					},
					{ full_name: 'ablaszkiewicz/gardener-game', clone_url: 'https://github.com/a/g.git' },
					{ full_name: 'broken/entry' },
					null,
				]),
			),
		);
		boot({ ghRunner: run });
		expect(await invoke('repositories.list-github-repositories')).toEqual([
			{
				fullName: 'bestboyhq/malini',
				cloneUrl: 'https://github.com/bestboyhq/malini.git',
				description: 'ADE for the rest of us.',
				private: true,
				pushedAt: '2026-11-03T09:00:00Z',
			},
			{
				fullName: 'ablaszkiewicz/gardener-game',
				cloneUrl: 'https://github.com/a/g.git',
				description: null,
				private: false,
				pushedAt: null,
			},
		]);
		expect(calls[0]?.args).toEqual(['api', expect.stringContaining('user/repos?sort=pushed')]);
	});

	it('fails with the gh sign-in error when gh is signed out', async () => {
		const { run } = fakeRunner(() =>
			ok('', 1, 'You are not logged into any GitHub hosts. To log in, run: gh auth login'),
		);
		boot({ ghRunner: run });
		await expect(invoke('repositories.list-github-repositories')).rejects.toThrow(
			/not logged into any GitHub hosts/,
		);
	});
});

describe('repositories.list-github-owners', () => {
	it('lists your login first, then every organization you belong to', async () => {
		const { run } = fakeRunner((args) => {
			if (args[1] === 'user') return ok('szymeo\n');
			return ok(JSON.stringify([{ login: 'bestboyhq' }, { login: 'logdash-io' }, {}]));
		});
		boot({ ghRunner: run });
		expect(await invoke('repositories.list-github-owners')).toEqual([
			'szymeo',
			'bestboyhq',
			'logdash-io',
		]);
	});
});

describe('repositories.create-github-repository', () => {
	const created = {
		full_name: 'bestboyhq/share-links',
		clone_url: 'https://github.com/bestboyhq/share-links.git',
		description: null,
		private: true,
		pushed_at: '2026-11-03T15:00:00Z',
	};

	it('creates the repository with a first commit under your account or an organization', async () => {
		const { run, calls } = fakeRunner((args) =>
			args[1] === 'user' ? ok('szymeo\n') : ok(JSON.stringify(created)),
		);
		boot({ ghRunner: run });
		expect(
			await invoke('repositories.create-github-repository', {
				owner: 'bestboyhq',
				name: 'share-links',
				private: true,
			}),
		).toEqual({
			fullName: 'bestboyhq/share-links',
			cloneUrl: 'https://github.com/bestboyhq/share-links.git',
			description: null,
			private: true,
			pushedAt: '2026-11-03T15:00:00Z',
		});
		await invoke('repositories.create-github-repository', {
			owner: 'Szymeo',
			name: 'notes',
			private: false,
		});
		expect(calls.map((call) => call.args).filter((args) => args[1] === '--method')).toEqual([
			[
				'api',
				'--method',
				'POST',
				'orgs/bestboyhq/repos',
				'-f',
				'name=share-links',
				'-F',
				'private=true',
				'-F',
				'auto_init=true',
			],
			[
				'api',
				'--method',
				'POST',
				'user/repos',
				'-f',
				'name=notes',
				'-F',
				'private=false',
				'-F',
				'auto_init=true',
			],
		]);
	});

	it('fails with the reason GitHub gives, not its status code', async () => {
		const { run } = fakeRunner((args) =>
			args[1] === 'user'
				? ok('szymeo\n')
				: ok(
						JSON.stringify({
							message: 'Repository creation failed.',
							errors: [{ field: 'name', message: 'name already exists on this account' }],
						}),
						1,
						'gh: Repository creation failed. (HTTP 422)',
					),
		);
		boot({ ghRunner: run });
		await expect(
			invoke('repositories.create-github-repository', {
				owner: 'szymeo',
				name: 'dotfiles',
				private: true,
			}),
		).rejects.toThrow('Name already exists on this account');
	});

	it('refuses a name GitHub would not take, before asking it', async () => {
		const { run, calls } = fakeRunner(() => ok('szymeo\n'));
		boot({ ghRunner: run });
		for (const name of ['a/b', '..', 'with space', '']) {
			await expect(
				invoke('repositories.create-github-repository', { owner: 'szymeo', name, private: true }),
			).rejects.toThrow(/invalid args/);
		}
		expect(calls).toEqual([]);
	});
});

describe('repositories.connect', () => {
	it('reads a folder remote and default branch into the connected record', async () => {
		const repoPath = join(root, 'checkout');
		gitRepoWithRemote(repoPath, 'git@github.com:bestboyhq/malini.git');
		const { run } = fakeRunner(() => ok(''));
		boot({ ghRunner: run });

		const { repository: imported } = await invoke<{
			repository: { fullName: string; defaultBranch: string; localPath: string };
		}>('repositories.connect', { source: { kind: 'local-folder', path: repoPath } });
		expect(imported.fullName).toBe('bestboyhq/malini');
		expect(imported.defaultBranch).toBe('main');
		expect(imported.localPath).toBe(repoPath);
		expect(listConnectedRepositories(db)).toHaveLength(1);
		expect(imported).not.toHaveProperty('workstreamId');
	});

	it('falls back to the folder name when there is no remote', async () => {
		const repoPath = join(root, 'plain-folder');
		execFileSync('git', ['init', '-q', '-b', 'main', repoPath]);
		const { run } = fakeRunner(() => ok(''));
		boot({ ghRunner: run });
		const { repository: imported } = await invoke<{ repository: { fullName: string } }>(
			'repositories.connect',
			{ source: { kind: 'local-folder', path: repoPath } },
		);
		expect(imported.fullName).toBe('plain-folder');
	});

	it('hands back and unhides a repository that is connected again', async () => {
		const repoPath = join(root, 'dupe');
		gitRepoWithRemote(repoPath, 'git@github.com:bestboyhq/malini.git');
		const { run } = fakeRunner(() => ok(''));
		boot({ ghRunner: run });
		const first = await invoke<{ repository: { id: string }; created: boolean }>(
			'repositories.connect',
			{ source: { kind: 'local-folder', path: repoPath } },
		);
		setRepositoryHidden(db, first.repository.id, true);

		const again = await invoke<{ repository: { id: string }; created: boolean }>(
			'repositories.connect',
			{ source: { kind: 'clone-url', url: 'https://github.com/bestboyhq/malini.git' } },
		);

		expect(first.created).toBe(true);
		expect(again).toEqual({ repository: first.repository, created: false });
		expect(listConnectedRepositories(db)).toHaveLength(1);
		expect(listHiddenRepositoryIds(db)).toEqual([]);
	});

	it('imports a clone URL and asks gh for the default branch', async () => {
		const { run, calls } = fakeRunner((args) => {
			if (args[0] === 'repo') return ok('develop\n');
			return ok('');
		});
		boot({ ghRunner: run });
		const { repository: imported } = await invoke<{ repository: unknown }>('repositories.connect', {
			source: { kind: 'clone-url', url: 'https://github.com/bestboyhq/malini.git' },
		});
		expect(imported).toMatchObject({
			fullName: 'bestboyhq/malini',
			defaultBranch: 'develop',
			localPath: null,
			remoteUrl: 'https://github.com/bestboyhq/malini.git',
		});
		expect(calls.some((call) => call.args[0] === 'repo')).toBe(true);
	});

	it('names a repository from any host by owner and name, the way its project is named', async () => {
		const repoPath = join(root, 'gitlab-checkout');
		gitRepoWithRemote(repoPath, 'git@gitlab.com:rabbits/hutch.git');
		const { run, calls } = fakeRunner(() => ok('develop\n'));
		boot({ ghRunner: run });
		const { repository: cloned } = await invoke<{ repository: unknown }>('repositories.connect', {
			source: { kind: 'clone-url', url: 'https://gitlab.com/bestboyhq/malini.git' },
		});
		const { repository: folder } = await invoke<{ repository: { fullName: string } }>(
			'repositories.connect',
			{ source: { kind: 'local-folder', path: repoPath } },
		);
		expect(cloned).toMatchObject({ fullName: 'bestboyhq/malini', defaultBranch: 'main' });
		expect(folder.fullName).toBe('rabbits/hutch');
		expect(calls.some((call) => call.args[0] === 'repo')).toBe(false);
	});

	it('renames a clone stored under its folder name to the owner and name of its remote', async () => {
		boot({ ghRunner: fakeRunner(() => ok('')).run });
		upsertConnectedRepository(db, {
			id: 'stored-clone',
			fullName: 'malini',
			defaultBranch: 'main',
			localPath: null,
			remoteUrl: 'https://gitlab.com/bestboyhq/malini.git',
			createdAt: '2026-01-01T00:00:00.000Z',
		});
		const listed = await invoke<{ id: string; fullName: string }[]>('repositories.list-clones', {});
		expect(listed).toEqual([
			expect.objectContaining({ id: 'stored-clone', fullName: 'bestboyhq/malini' }),
		]);
	});
});

describe('the repositories register', () => {
	it('defines every repositories command and nothing from another domain', () => {
		boot({ ghRunner: fakeRunner(() => ok('')).run });
		expect(context.commands.names().every((name) => name.startsWith('repositories.'))).toBe(true);
		expect(context.commands.names()).toContain('repositories.github-auth-status');
		expect(context.commands.names()).toContain('repositories.connect');
		expect(context.commands.names()).toContain('repositories.owner-avatar');
		expect(context.commands.names()).toContain('repositories.pick-folder');
	});
});

describe('repositories.owner-avatar', () => {
	const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

	it('serves the owner avatar through the injected fetcher', async () => {
		const urls: string[] = [];
		boot({
			ghRunner: fakeRunner(() => ok('')).run,
			avatars: {
				fetcher: async (url) => {
					urls.push(url);
					return new Response(PNG, { status: 200 });
				},
			},
		});
		const avatar = await invoke<{ mediaType: string; base64: string } | null>(
			'repositories.owner-avatar',
			{ owner: 'octocat' },
		);
		expect(avatar).toEqual({ mediaType: 'image/png', base64: PNG.toString('base64') });
		expect(urls).toEqual(['https://github.com/octocat.png?size=128']);
		expect(existsSync(join(context.appDataRoot, 'avatars', 'octocat.png'))).toBe(true);
	});

	it('rejects an owner that is not a GitHub login', async () => {
		boot({
			ghRunner: fakeRunner(() => ok('')).run,
			avatars: { fetcher: async () => new Response(PNG, { status: 200 }) },
		});
		await expect(invoke('repositories.owner-avatar', { owner: 'owner/name' })).rejects.toThrow(
			/invalid args/,
		);
	});
});

describe('githubAuthStatus', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
	});

	it('gives up on a gh that never answers and kills it, so setup stops checking', async () => {
		const home = mkdtempSync(join(tmpdir(), 'malini-gh-hangs-'));
		mkdirSync(join(home, '.local', 'bin'), { recursive: true });
		writeFileSync(
			join(home, '.local', 'bin', 'gh'),
			'#!/bin/sh\necho $$ > "$HOME/gh.pid"\nexec sleep 60\n',
			{ mode: 0o755 },
		);
		vi.stubEnv('HOME', home);
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

		const status = expect(githubAuthStatus(defaultGhRunner)).rejects.toThrow(
			'GitHub did not answer in 15 seconds.',
		);
		const pid = await vi.waitFor(() => {
			const started = Number(readFileSync(join(home, 'gh.pid'), 'utf8'));
			expect(started).toBeGreaterThan(0);
			return started;
		});
		await vi.advanceTimersByTimeAsync(GH_ANSWER_TIMEOUT_MS);
		await status;

		vi.useRealTimers();
		await vi.waitFor(() => expect(processIsAlive(pid)).toBe(false));
		rmSync(home, { recursive: true, force: true });
	});
});
