import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
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
import type { GhRunner } from './github.service';
import {
	getConnectedRepository,
	listConnectedRepositories,
	upsertConnectedRepository,
} from './connected-repositories.repository';
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

	it('reports gh missing while other commands keep working', async () => {
		const run: GhRunner = () => Promise.reject(GhError.notInstalled());
		boot({ ghRunner: run });
		const status = await invoke<{ authenticated: boolean; installed: boolean }>(
			'repositories.github-auth-status',
		);
		expect(status).toMatchObject({ authenticated: false, installed: false });
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
			},
			{
				fullName: 'ablaszkiewicz/gardener-game',
				cloneUrl: 'https://github.com/a/g.git',
				description: null,
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

describe('repositories.connect', () => {
	it('reads a folder remote and default branch into the connected record', async () => {
		const repoPath = join(root, 'checkout');
		gitRepoWithRemote(repoPath, 'git@github.com:bestboyhq/malini.git');
		const { run } = fakeRunner(() => ok(''));
		boot({ ghRunner: run });

		const imported = await invoke<{ fullName: string; defaultBranch: string; localPath: string }>(
			'repositories.connect',
			{ source: { kind: 'local-folder', path: repoPath } },
		);
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
		const imported = await invoke<{ fullName: string; remoteUrl: string | null }>(
			'repositories.connect',
			{ source: { kind: 'local-folder', path: repoPath } },
		);
		expect(imported.fullName).toBe('plain-folder');
	});

	it('rejects a duplicate connection with the renderer-matching message', async () => {
		const repoPath = join(root, 'dupe');
		gitRepoWithRemote(repoPath, 'git@github.com:bestboyhq/malini.git');
		const { run } = fakeRunner(() => ok(''));
		boot({ ghRunner: run });
		await invoke('repositories.connect', {
			source: { kind: 'local-folder', path: repoPath },
		});
		await expect(
			invoke('repositories.connect', {
				source: { kind: 'local-folder', path: repoPath },
			}),
		).rejects.toThrow(/already connected/);
	});

	it('imports a clone URL and asks gh for the default branch', async () => {
		const { run, calls } = fakeRunner((args) => {
			if (args[0] === 'repo') return ok('develop\n');
			return ok('');
		});
		boot({ ghRunner: run });
		const imported = await invoke<{
			fullName: string;
			defaultBranch: string;
			localPath: string | null;
			remoteUrl: string | null;
		}>('repositories.connect', {
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
		const cloned = await invoke<{ fullName: string; defaultBranch: string }>(
			'repositories.connect',
			{ source: { kind: 'clone-url', url: 'https://gitlab.com/bestboyhq/malini.git' } },
		);
		const folder = await invoke<{ fullName: string }>('repositories.connect', {
			source: { kind: 'local-folder', path: repoPath },
		});
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

	it('removes a connected repository', async () => {
		const repoPath = join(root, 'remove-me');
		gitRepoWithRemote(repoPath, 'git@github.com:bestboyhq/malini.git');
		const { run } = fakeRunner(() => ok(''));
		boot({ ghRunner: run });
		const imported = await invoke<{ id: string }>('repositories.connect', {
			source: { kind: 'local-folder', path: repoPath },
		});
		await invoke('repositories.disconnect', { repoId: imported.id });
		expect(getConnectedRepository(db, imported.id)).toBeNull();
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
