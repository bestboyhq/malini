import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '$hyper-ui/components/toast';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { gate, interceptCommand } from '$shared/repositories/application/provisioning.testkit';
import { CommandError } from '$contract/command-failure';
import { connectedRepositoriesQuery } from '$shared/repositories/application/queries/connected-repositories.query.svelte';
import { repositoryConnectErrorQuery } from '$shared/repositories/application/queries/repository-connect-error.query.svelte';
import { repositoryConnectingQuery } from '$shared/repositories/application/queries/repository-connecting.query.svelte';
import type { RepositoryImportSource } from '$shared/repositories/domain/github-auth';
import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { repositoryConnectionStore } from '$shared/repositories/infrastructure/stores/repository-connection.store.svelte';
import { connectRepositoryCommand } from './connect-repository.command';
import { openRepositoryFolderCommand } from './open-repository-folder.command';

const WORKSTREAM_ID = '01JCONNECTTESTAAA';

const navigation = vi.hoisted(() => ({ goto: vi.fn(async (_href: string) => undefined) }));

vi.mock('$shared/router/navigation', () => navigation);

vi.mock(import('$shared/repositories/domain/project-identity'), async (importOriginal) => ({
	...(await importOriginal()),
	nextWorkstreamId: () => WORKSTREAM_ID,
}));

const source: RepositoryImportSource = {
	kind: 'clone-url',
	url: 'https://github.com/rabbits/hutch.git',
};

let platform: FakePlatform;

beforeEach(() => {
	navigation.goto.mockClear();
	platform = createFakePlatform({ projects: [], workstreams: [] });
	setPlatformForTest(platform);
	repositoriesAggregate.reset();
	workstreamsAggregate.reset();
	repositoryConnectionStore.reset();
});

afterEach(() => {
	vi.restoreAllMocks();
	setPlatformForTest(null);
	repositoriesAggregate.reset();
	workstreamsAggregate.reset();
	repositoryConnectionStore.reset();
});

function commands(): string[] {
	return platform.calls
		.map(({ command }) => command)
		.filter((command) => command.startsWith('repositories.'));
}

function argsOf(command: string): unknown[] {
	return platform.calls.filter((call) => call.command === command).map(({ args }) => args);
}

async function settled(): Promise<void> {
	await vi.waitFor(() => expect(repositoryConnectingQuery.data).toBeNull());
}

async function connectExisting(): Promise<string> {
	const existing = await platform.invoke('repositories.connect', { source });
	platform.calls.length = 0;
	return existing.id;
}

describe('connecting a repository', () => {
	it('creates the repository record, clones it, opens its first workstream, and navigates there', async () => {
		const onConnected = vi.fn();

		connectRepositoryCommand(source, onConnected);

		expect(repositoryConnectingQuery.data).toBe('clone');
		await settled();
		expect(argsOf('repositories.create-repository')).toEqual([
			{ repoUrl: 'https://github.com/rabbits/hutch.git' },
		]);
		expect(argsOf('repositories.create-workstream')).toEqual([
			{
				projectRepoPath: '/tmp/malini/repositories/rabbits__hutch/base',
				workstreamId: WORKSTREAM_ID,
				baseBranch: 'main',
				projectId: 'local__rabbits__hutch',
				name: 'Silver Summit',
			},
		]);
		expect(workstreamsAggregate.workstreams.map((entry) => entry.id)).toContain(WORKSTREAM_ID);
		expect(repositoriesAggregate.items.map((repo) => repo.fullName)).toEqual(['rabbits/hutch']);
		expect(navigation.goto).toHaveBeenCalledWith(`/workstreams/${WORKSTREAM_ID}`);
		expect(onConnected).toHaveBeenCalledOnce();
		expect(repositoryConnectErrorQuery.data).toBeNull();
	});

	it('names the first workstream apart from a workstream that already has its generated name', async () => {
		platform = createFakePlatform({
			projects: [],
			workstreams: [
				{
					id: '01JEXISTINGNAMEA',
					projectId: 'project-other',
					name: 'Silver Summit',
					path: '/tmp/existing',
					branch: 'malini/existing',
					baseBranch: 'main',
					status: 'active',
				},
			],
		});
		setPlatformForTest(platform);
		await workstreamsAggregate.refresh();

		connectRepositoryCommand(source);
		await settled();

		const [created] = argsOf('repositories.create-workstream');
		expect(created).toMatchObject({ workstreamId: WORKSTREAM_ID });
		expect(created).not.toMatchObject({ name: 'Silver Summit' });
	});

	it('does not clone locally when the repository record is refused', async () => {
		const error = vi.spyOn(toast, 'error');
		const onConnected = vi.fn();
		platform.define('repositories.connect', () => {
			throw new Error('REPOSITORY_SCOPE_MISMATCH');
		});

		connectRepositoryCommand(source, onConnected);
		await settled();

		expect(commands()).toEqual(['repositories.connect']);
		expect(repositoryConnectErrorQuery.data?.detail).toBe('REPOSITORY_SCOPE_MISMATCH');
		expect(error).toHaveBeenCalledWith('Could not connect repository · REPOSITORY_SCOPE_MISMATCH');
		expect(onConnected).not.toHaveBeenCalled();
		expect(navigation.goto).not.toHaveBeenCalled();
	});

	it.each([
		['the clone', 'repositories.create-repository', 'git clone failed', 'git clone failed'],
		[
			'the project lookup',
			'repositories.list-repositories',
			'local project lookup failed',
			'local project lookup failed',
		],
		[
			'the first workstream',
			'repositories.create-workstream',
			'worktree checkout failed',
			'workstream checkout failed',
		],
	] as const)('rolls the new record back when %s fails', async (_step, command, cause, shown) => {
		interceptCommand(platform, command, () => {
			throw new Error(cause);
		});

		connectRepositoryCommand(source);
		await settled();

		expect(argsOf('repositories.disconnect')).toEqual([{ repoId: 'fake-repo-1' }]);
		expect(repositoryConnectErrorQuery.data?.detail).toBe(shown);
		expect(workstreamsAggregate.workstreams).toEqual([]);
		expect(navigation.goto).not.toHaveBeenCalled();
	});

	it('preserves the original error when the rollback itself fails', async () => {
		interceptCommand(platform, 'repositories.create-repository', () => {
			throw new Error('git clone failed');
		});
		const rollback = vi.fn(() => {
			throw new Error('rollback delete failed');
		});
		interceptCommand(platform, 'repositories.disconnect', rollback);

		connectRepositoryCommand(source);
		await settled();

		expect(rollback).toHaveBeenCalledOnce();
		expect(repositoryConnectErrorQuery.data?.detail).toBe('git clone failed');
	});

	it('continues from an already connected record without ever rolling it back', async () => {
		const existingId = await connectExisting();
		interceptCommand(platform, 'repositories.create-repository', () => {
			throw new Error('git clone failed');
		});

		connectRepositoryCommand(source);
		await settled();

		expect(commands()).toContain('repositories.list-clones');
		expect(existingId).toBe('fake-repo-1');
		expect(commands()).not.toContain('repositories.disconnect');
		expect(repositoryConnectErrorQuery.data?.detail).toBe('git clone failed');
	});

	it('opens a workstream in an already connected repository', async () => {
		await connectExisting();

		connectRepositoryCommand(source);
		await settled();

		expect(commands()).not.toContain('repositories.disconnect');
		expect(navigation.goto).toHaveBeenCalledWith(`/workstreams/${WORKSTREAM_ID}`);
	});

	it('reuses an existing local project instead of cloning a duplicate', async () => {
		platform.seed({
			projects: [
				{
					id: 'local__rabbits__hutch',
					name: 'rabbits__hutch',
					repoPath: '/tmp/existing/rabbits__hutch',
					defaultBranch: 'main',
				},
			],
			workstreams: [],
		});

		connectRepositoryCommand(source);
		await settled();

		expect(commands()).not.toContain('repositories.create-repository');
		expect(argsOf('repositories.create-workstream')).toEqual([
			expect.objectContaining({
				projectId: 'local__rabbits__hutch',
				projectRepoPath: '/tmp/existing/rabbits__hutch',
			}),
		]);
	});

	it('says GitHub gave no access when the clone of a missing or private repository asks for a login', async () => {
		const error = vi.spyOn(toast, 'error');
		const missing: RepositoryImportSource = {
			kind: 'clone-url',
			url: 'https://github.com/bestboyhq/does-not-exist-o11y-probe',
		};
		interceptCommand(platform, 'repositories.create-repository', () => {
			throw new CommandError({
				name: 'GitError',
				message:
					"git could not authenticate: could not read Username for 'https://github.com': terminal prompts disabled",
				code: null,
				kind: 'auth-failed',
				command: 'repositories.create-repository',
			});
		});

		connectRepositoryCommand(missing);
		await settled();

		expect(repositoryConnectErrorQuery.data).toEqual({
			detail: "GitHub didn't give access to bestboyhq/does-not-exist-o11y-probe.",
			remedy: 'Check the URL, or sign in with `gh auth login` as an account that can see it.',
			technical:
				"git could not authenticate: could not read Username for 'https://github.com': terminal prompts disabled",
		});
		expect(error).toHaveBeenCalledOnce();
		expect(error).toHaveBeenCalledWith(
			"Could not connect repository · GitHub didn't give access to bestboyhq/does-not-exist-o11y-probe. Check the URL, or sign in with `gh auth login` as an account that can see it.",
		);
	});

	it('still asks to reconnect when the GitHub CLI rejects its own sign-in', async () => {
		platform.define('repositories.connect', () => {
			throw new CommandError({
				name: 'GhError',
				message: 'HTTP 401: Bad credentials (https://api.github.com/graphql)',
				code: '1',
				kind: 'auth-required',
				command: 'repositories.connect',
			});
		});

		connectRepositoryCommand(source);
		await settled();

		expect(repositoryConnectErrorQuery.data).toMatchObject({
			detail: 'The GitHub CLI is not signed in, or its sign-in has expired.',
			remedy: 'Reconnect it with `gh auth login` in a terminal, then try again.',
		});
	});

	it('never lists the repository while its connect runs, or after it fails', async () => {
		await repositoriesAggregate.refresh();
		const clone = gate<void>();
		interceptCommand(platform, 'repositories.create-repository', async () => {
			await clone.promise;
			throw new Error('git clone failed');
		});

		connectRepositoryCommand(source);
		await vi.waitFor(() => expect(argsOf('repositories.connect')).toHaveLength(1));
		await repositoriesAggregate.refresh();
		expect(connectedRepositoriesQuery.data.map((repo) => repo.fullName)).toEqual([]);

		clone.resolve();
		await settled();
		await repositoriesAggregate.refresh();

		expect(connectedRepositoriesQuery.data.map((repo) => repo.fullName)).toEqual([]);
	});

	it('runs one connection at a time', async () => {
		const clone = gate<void>();
		interceptCommand(platform, 'repositories.create-repository', () => clone.promise);

		connectRepositoryCommand(source);
		connectRepositoryCommand({ kind: 'local-folder', path: '/tmp/other' });
		clone.resolve();
		await settled();

		expect(argsOf('repositories.connect')).toEqual([{ source }]);
	});
});

describe('opening a repository folder', () => {
	it('connects the folder the picker returns', async () => {
		platform.define('repositories.pick-folder', () => '/tmp/hutch');

		openRepositoryFolderCommand();

		await vi.waitFor(() => expect(navigation.goto).toHaveBeenCalled());
		expect(argsOf('repositories.connect')).toEqual([
			{ source: { kind: 'local-folder', path: '/tmp/hutch' } },
		]);
	});

	it('does nothing when the picker is cancelled', async () => {
		openRepositoryFolderCommand();

		await vi.waitFor(() => expect(commands()).toEqual(['repositories.pick-folder']));
		expect(repositoryConnectErrorQuery.data).toBeNull();
	});

	it('explains a picker that would not open', async () => {
		platform.define('repositories.pick-folder', () => {
			throw new Error('dialog unavailable');
		});

		openRepositoryFolderCommand();

		await vi.waitFor(() =>
			expect(repositoryConnectErrorQuery.data?.detail).toBe('dialog unavailable'),
		);
		expect(commands()).not.toContain('repositories.connect');
	});
});
