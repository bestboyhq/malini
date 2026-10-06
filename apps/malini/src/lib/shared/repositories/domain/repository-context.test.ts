import { describe, expect, it } from 'vitest';
import type { Project, Repository } from './repository';
import type { Workstream } from './workstream';
import {
	connectedRepositoryContexts,
	githubOwnerFromFullName,
	localRepositoriesFromProjects,
	mergeRepositories,
	projectIdentityIdsForRepository,
	repositoryContextForWorkstream,
	repositoryCloneSource,
	repositoryFullNameFromRemoteUrl,
	repositoryIdentityForImportSource,
	supportsRemotePullRequests,
} from '$shared/repositories/domain/repository-context';

const repo = (overrides: Partial<Repository> = {}): Repository => ({
	id: 'repo-rabbits-hutch',
	fullName: 'rabbits/hutch',
	defaultBranch: 'main',
	localPath: '/Users/dev/code/hutch',
	remoteUrl: 'https://github.com/rabbits/hutch.git',
	createdAt: '2026-07-05T00:00:00.000Z',
	...overrides,
});

const stream = (overrides: Partial<Workstream> = {}): Workstream => ({
	id: 'stream-1',
	projectId: 'local__rabbits__hutch',
	name: 'Bright Thread',
	path: '/tmp/malini/workstreams/stream-1',
	branch: 'malini/stream-1',
	baseBranch: 'main',
	status: 'active',
	checkoutState: 'healthy',
	checkoutIssue: null,
	resolvedPath: null,
	...overrides,
});

describe('repository context', () => {
	it('derives current and legacy project ids for a connected repository', () => {
		expect(projectIdentityIdsForRepository('rabbits/hutch')).toEqual([
			'local__rabbits__hutch',
			'local__hutch',
		]);
	});

	it('lists a connected repository before any work stream is attached', () => {
		const contexts = connectedRepositoryContexts({
			repositories: [repo()],
			workstreams: [],
			activeWorkstreamId: null,
		});
		expect(contexts).toHaveLength(1);
		expect(contexts[0]?.workstreams).toEqual([]);
		expect(contexts[0]?.targetWorkstream).toBeNull();
		expect(contexts[0]?.isActive).toBe(false);
	});

	it('resolves active repository context through current and legacy project ids', () => {
		const contexts = connectedRepositoryContexts({
			repositories: [repo()],
			workstreams: [
				stream({ id: 'stream-older' }),
				stream({ id: 'stream-active', branch: 'malini/stream-active' }),
			],
			activeWorkstreamId: 'stream-active',
		});
		expect(contexts[0]?.targetWorkstream?.id).toBe('stream-active');
		expect(contexts[0]?.activeWorkstream?.id).toBe('stream-active');
		expect(contexts[0]?.workstreams.map((entry) => entry.id)).toEqual([
			'stream-older',
			'stream-active',
		]);

		const current = repositoryContextForWorkstream({
			repositories: [repo()],
			workstreams: [stream()],
			workstreamId: 'stream-1',
		});
		expect(current).toMatchObject({
			repo: { fullName: 'rabbits/hutch' },
			activeWorkstream: { id: 'stream-1' },
			targetWorkstream: { id: 'stream-1' },
			isActive: true,
		});

		const legacy = repositoryContextForWorkstream({
			repositories: [repo()],
			workstreams: [stream({ id: 'stream-legacy', projectId: 'local__hutch' })],
			workstreamId: 'stream-legacy',
		});
		expect(legacy).toMatchObject({
			repo: { fullName: 'rabbits/hutch' },
			activeWorkstream: { id: 'stream-legacy' },
			isActive: true,
		});
	});

	it('does not match a work stream whose project id carries a foreign prefix', () => {
		expect(
			repositoryContextForWorkstream({
				repositories: [repo()],
				workstreams: [stream({ id: 'foreign', projectId: 'other-ws__rabbits__hutch' })],
				workstreamId: 'foreign',
			}),
		).toBeNull();
	});

	it('preserves exact repository identity from local Git origin URLs', () => {
		expect(repositoryFullNameFromRemoteUrl('git@github.com:szymeo/blog.dev.git')).toBe(
			'szymeo/blog.dev',
		);
		expect(repositoryFullNameFromRemoteUrl('https://github.com/szymeo/dotfiles.git')).toBe(
			'szymeo/dotfiles',
		);
	});

	it('derives backend-independent repository rows from local projects', () => {
		const projects: Project[] = [
			{
				id: 'local__szymeo__blog_dev',
				name: 'blog.dev',
				repoPath: '/tmp/repositories/szymeo__blog_dev/base',
				defaultBranch: 'main',
				remoteUrl: 'git@github.com:szymeo/blog.dev.git',
			},
		];

		expect(localRepositoriesFromProjects(projects)).toEqual([
			expect.objectContaining({
				id: 'local:local__szymeo__blog_dev',
				fullName: 'szymeo/blog.dev',
				defaultBranch: 'main',
			}),
		]);
	});

	it('keeps a local repository whose origin cannot be read', () => {
		const projects: Project[] = [
			{
				id: 'local__local__scratchpad',
				name: 'scratchpad',
				repoPath: '/tmp/repositories/local__scratchpad/base',
				defaultBranch: 'main',
				remoteUrl: null,
			},
		];

		const repos = localRepositoriesFromProjects(projects);
		expect(repos).toEqual([
			expect.objectContaining({
				id: 'local:local__local__scratchpad',
				defaultBranch: 'main',
			}),
		]);
		expect(repos[0]?.fullName).toContain('scratchpad');

		const contexts = connectedRepositoryContexts({
			repositories: repos,
			workstreams: [stream({ projectId: 'local__local__scratchpad' })],
			activeWorkstreamId: 'stream-1',
		});
		expect(contexts.map((context) => context.workstreams.map((entry) => entry.id))).toEqual([
			['stream-1'],
		]);
	});

	it('matches local repositories directly to their persisted project id', () => {
		const localRepo = repo({
			id: 'local:native-self-build',
			fullName: 'acme/monorepo',
		});
		const current = repositoryContextForWorkstream({
			repositories: [localRepo],
			workstreams: [stream({ projectId: 'native-self-build' })],
			workstreamId: 'stream-1',
		});

		expect(current).toMatchObject({
			repo: { id: 'local:native-self-build', fullName: 'acme/monorepo' },
			activeWorkstream: { id: 'stream-1' },
		});
	});

	it('never lists one work stream under two repositories', () => {
		const connected = repo({ id: 'connected-hutch', fullName: 'rabbits/hutch' });
		const sameProjectClonedElsewhere = localRepositoriesFromProjects([
			{
				id: 'local__rabbits__hutch',
				name: 'hutch',
				repoPath: '/tmp/checkouts/warren',
				defaultBranch: 'main',
				remoteUrl: null,
			},
		]);
		const contexts = connectedRepositoryContexts({
			repositories: mergeRepositories([connected], sameProjectClonedElsewhere),
			workstreams: [stream()],
			activeWorkstreamId: 'stream-1',
		});

		expect(contexts.flatMap((context) => context.workstreams.map((found) => found.id))).toEqual([
			'stream-1',
		]);
	});

	it('merges local-only repositories while preferring connected metadata', () => {
		const connected = repo({ id: 'connected-hutch' });
		const localDuplicate = repo({ id: 'local:duplicate', localPath: null });
		const localOnly = repo({ id: 'local:native-app', fullName: 'acme/monorepo' });

		expect(mergeRepositories([connected], [localDuplicate, localOnly])).toEqual([
			connected,
			localOnly,
		]);
	});

	it('gives a work stream to one repository when two rows resolve to its project', () => {
		const connected = repo({ id: 'connected-malini', fullName: 'bestboyhq/malini' });
		const localFallback = repo({
			id: 'local:local__bestboyhq__malini',
			fullName: 'bestboyhq__malini',
			localPath: null,
			remoteUrl: null,
		});
		const workstreams = [stream({ projectId: 'local__bestboyhq__malini' })];

		const contexts = connectedRepositoryContexts({
			repositories: [connected, localFallback],
			workstreams,
			activeWorkstreamId: 'stream-1',
		});

		expect(contexts.map((context) => context.repo.id)).toEqual(['connected-malini']);
		expect(contexts[0]?.workstreams.map((entry) => entry.id)).toEqual(['stream-1']);
	});

	it('offers pull requests only to repositories whose origin is on GitHub', () => {
		expect(supportsRemotePullRequests(repo())).toBe(true);
		expect(supportsRemotePullRequests(repo({ id: 'local:project', remoteUrl: null }))).toBe(false);
		expect(
			supportsRemotePullRequests(repo({ remoteUrl: 'https://gitlab.com/rabbits/hutch.git' })),
		).toBe(false);
		expect(
			supportsRemotePullRequests(repo({ remoteUrl: 'git@github.com:rabbits/hutch.git' })),
		).toBe(true);
		expect(supportsRemotePullRequests(null)).toBe(false);
	});

	it('clones from the GitHub remote when there is one and from the folder otherwise', () => {
		expect(repositoryCloneSource(repo())).toBe('https://github.com/rabbits/hutch.git');
		expect(repositoryCloneSource(repo({ remoteUrl: null }))).toBe('/Users/dev/code/hutch');
		expect(() => repositoryCloneSource(repo({ remoteUrl: null, localPath: null }))).toThrow();
	});

	it('names an import by its remote or by its folder before the main process answers', () => {
		expect(
			repositoryIdentityForImportSource({
				kind: 'clone-url',
				url: 'git@github.com:rabbits/hutch.git',
			}),
		).toEqual({
			fullName: 'rabbits/hutch',
			localPath: null,
			remoteUrl: 'git@github.com:rabbits/hutch.git',
		});
		expect(
			repositoryIdentityForImportSource({ kind: 'local-folder', path: '/Users/dev/code/hutch/' }),
		).toEqual({ fullName: 'hutch', localPath: '/Users/dev/code/hutch/', remoteUrl: null });
	});
});

describe('githubOwnerFromFullName', () => {
	it('reads the owner out of an owner/name', () => {
		expect(githubOwnerFromFullName('bestboyhq/malini')).toBe('bestboyhq');
		expect(githubOwnerFromFullName('octo-cat/hello-world')).toBe('octo-cat');
	});

	it('answers null for a folder name, a path, or an invalid login', () => {
		expect(githubOwnerFromFullName('malini')).toBeNull();
		expect(githubOwnerFromFullName('work/malini/checkout')).toBeNull();
		expect(githubOwnerFromFullName('/malini')).toBeNull();
		expect(githubOwnerFromFullName('bestboyhq/')).toBeNull();
		expect(githubOwnerFromFullName('-bestboyhq/malini')).toBeNull();
		expect(githubOwnerFromFullName('avi atai/malini')).toBeNull();
		expect(githubOwnerFromFullName('a'.repeat(40) + '/malini')).toBeNull();
	});
});
