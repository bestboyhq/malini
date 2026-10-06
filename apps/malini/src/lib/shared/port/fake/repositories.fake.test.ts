import { describe, expect, it } from 'vitest';
import { createFakePlatform } from './create-fake-platform';

describe('fake repositories commands', () => {
	it('creates native-shaped local projects from clone urls', async () => {
		const fake = createFakePlatform({ projects: [], workstreams: [] });

		await expect(
			fake.invoke('repositories.create-repository', {
				repoUrl: 'https://github.com/rabbits/hutch.git',
			}),
		).resolves.toBe('/tmp/malini/repositories/rabbits__hutch/base');

		expect(await fake.invoke('repositories.list-repositories', undefined)).toEqual([
			{
				id: 'local__rabbits__hutch',
				name: 'rabbits__hutch',
				repoPath: '/tmp/malini/repositories/rabbits__hutch/base',
				defaultBranch: 'main',
				remoteUrl: 'https://github.com/rabbits/hutch.git',
				createdAt: '2026-01-01T00:00:00.000Z',
			},
		]);
	});

	it('makes inherited repository files available when a workstream is created', async () => {
		const fake = createFakePlatform({
			projects: [],
			workstreams: [],
			createdWorkstreamFileContents: {
				'.malini/workspace.json': '{"schemaVersion":1,"extensions":{}}',
			},
		});

		await fake.invoke('repositories.create-workstream', {
			projectRepoPath: '/tmp/malini',
			workstreamId: 'created-workstream',
			baseBranch: 'main',
			projectId: 'repo-1',
			name: 'Created workstream',
		});

		await expect(
			fake.invoke('extensions.read-workstream-file', {
				extensionId: 'malini.workstream-configuration',
				workstreamId: 'created-workstream',
				path: '.malini/workspace.json',
			}),
		).resolves.toBe('{"schemaVersion":1,"extensions":{}}');
		expect(
			await fake.invoke('repositories.workstream-files', { workstreamId: 'created-workstream' }),
		).toEqual([{ path: '.malini/workspace.json' }]);
	});

	it('mutates seeded workstreams, returns diffs, records calls, and emits lifecycle events', async () => {
		const fake = createFakePlatform({
			projects: [{ id: 'repo-1', name: 'malini', repoPath: '/tmp/malini', defaultBranch: 'main' }],
			workstreams: [],
			diffs: {
				'ws-1': 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new',
			},
			workstreamFiles: { 'ws-1': ['src/app.ts', 'README.md'] },
			workstreamStatuses: {
				'ws-1': { branch: 'malini/ws-1', dirtyPaths: ['a.ts'], ahead: 1, behind: 0 },
			},
			workstreamChangeTotals: { 'ws-1': { additions: 34, deletions: 8, files: 3 } },
		});
		const lifecycle: string[] = [];
		fake.on('repositories:workstream-created', () => lifecycle.push('added'));
		fake.on('repositories:workstream-removed', () => lifecycle.push('removed'));

		const path = await fake.invoke('repositories.create-workstream', {
			projectRepoPath: '/tmp/malini',
			workstreamId: 'ws-1',
			baseBranch: 'main',
			projectId: 'repo-1',
			name: 'Fake pass',
		});

		expect(path).toBe('/tmp/malini/workstreams/ws-1');
		expect(await fake.invoke('repositories.list-repositories', undefined)).toMatchObject([
			{ id: 'repo-1', name: 'malini', repoPath: '/tmp/malini', defaultBranch: 'main' },
		]);
		expect(await fake.invoke('repositories.list-workstreams', undefined)).toMatchObject([
			{ id: 'ws-1', projectId: 'repo-1', status: 'active' },
		]);
		const diffArgs = { workstreamId: 'ws-1', path: null, baseBranch: 'main' };
		expect(await fake.invoke('repositories.workstream-diff', diffArgs)).toContain('+new');
		expect(fake.calls).toContainEqual({ command: 'repositories.workstream-diff', args: diffArgs });
		expect(await fake.invoke('repositories.workstream-files', { workstreamId: 'ws-1' })).toEqual([
			{ path: 'README.md' },
			{ path: 'src/app.ts' },
		]);
		expect(await fake.invoke('repositories.workstream-status', { workstreamId: 'ws-1' })).toEqual({
			branch: 'malini/ws-1',
			dirtyPaths: ['a.ts'],
			conflictedPaths: [],
			conflictMarkerPaths: [],
			ahead: 1,
			behind: 0,
			hasUpstream: true,
			mergeInProgress: false,
			operationInProgress: null,
			headSha: null,
		});
		const target = { workstreamId: 'ws-1', baseBranch: 'main' };
		expect(await fake.invoke('repositories.workstream-change-totals', target)).toEqual({
			additions: 34,
			deletions: 8,
			files: 3,
		});
		expect(await fake.invoke('repositories.workstream-snapshot', target)).toEqual({
			patch: expect.stringContaining('+new'),
			totals: { additions: 34, deletions: 8, files: 3 },
		});
		await fake.invoke('repositories.reveal-workstream', { workstreamId: 'ws-1' });
		await fake.invoke('repositories.open-workstream-in-editor', { workstreamId: 'ws-1' });
		expect(
			await fake.invoke('repositories.commit-workstream', {
				workstreamId: 'ws-1',
				message: 'ship',
			}),
		).toMatch(/^fake-commit-/u);
		expect(
			await fake.invoke('repositories.pull-workstream', {
				workstreamId: 'ws-1',
				baseBranch: 'main',
				githubToken: 'token',
			}),
		).toBe('main');

		await fake.invoke('repositories.archive-workstream', { workstreamId: 'ws-1' });
		expect(await fake.invoke('repositories.list-workstreams', undefined)).toMatchObject([
			{ status: 'archived' },
		]);

		await fake.invoke('repositories.delete-workstream', { workstreamId: 'ws-1' });
		expect(await fake.invoke('repositories.list-workstreams', undefined)).toEqual([]);
		expect(lifecycle).toEqual(['added', 'removed', 'removed']);
		expect(fake.calls.map((call) => call.command)).toEqual(
			expect.arrayContaining([
				'repositories.create-workstream',
				'repositories.list-repositories',
				'repositories.list-workstreams',
				'repositories.workstream-diff',
				'repositories.workstream-files',
				'repositories.workstream-status',
				'repositories.workstream-change-totals',
				'repositories.reveal-workstream',
				'repositories.open-workstream-in-editor',
				'repositories.commit-workstream',
				'repositories.pull-workstream',
				'repositories.archive-workstream',
				'repositories.delete-workstream',
			]),
		);
	});
});

describe('fake GitHub repository commands', () => {
	it('reports a signed-in gh and a cancelled folder picker by default', async () => {
		const fake = createFakePlatform();

		expect(await fake.invoke('repositories.github-auth-status', undefined)).toEqual({
			authenticated: true,
			installed: true,
			login: 'fake-user',
			host: 'github.com',
			message: null,
		});
		expect(await fake.invoke('repositories.pick-folder', undefined)).toBeNull();
	});

	it('connects clone urls and folders, lists them, and disconnects them', async () => {
		const fake = createFakePlatform();

		const remote = await fake.invoke('repositories.connect', {
			source: { kind: 'clone-url', url: 'git@github.com:rabbits/hutch.git' },
		});
		const folder = await fake.invoke('repositories.connect', {
			source: { kind: 'local-folder', path: '/Users/dev/work/burrow/' },
		});

		expect(remote).toMatchObject({
			id: 'fake-repo-1',
			fullName: 'rabbits/hutch',
			defaultBranch: 'main',
			localPath: null,
			remoteUrl: 'git@github.com:rabbits/hutch.git',
		});
		expect(folder).toMatchObject({
			id: 'fake-repo-2',
			fullName: 'burrow',
			localPath: '/Users/dev/work/burrow/',
			remoteUrl: null,
		});
		expect((await fake.invoke('repositories.list-clones', undefined)).map(({ id }) => id)).toEqual([
			'fake-repo-2',
			'fake-repo-1',
		]);

		await fake.invoke('repositories.disconnect', { repoId: 'fake-repo-1' });
		expect((await fake.invoke('repositories.list-clones', undefined)).map(({ id }) => id)).toEqual([
			'fake-repo-2',
		]);
	});

	it('refuses to connect the same repository twice, in the words the renderer matches', async () => {
		const fake = createFakePlatform();
		const source = { kind: 'clone-url', url: 'https://github.com/rabbits/hutch.git' } as const;
		await fake.invoke('repositories.connect', { source });

		await expect(
			fake.invoke('repositories.connect', {
				source: { kind: 'clone-url', url: 'https://github.com/Rabbits/Hutch' },
			}),
		).rejects.toThrow('Repository Rabbits/Hutch is already connected');
	});

	it('forgets connected repositories on reset', async () => {
		const fake = createFakePlatform();
		await fake.invoke('repositories.connect', {
			source: { kind: 'local-folder', path: '/tmp/hutch' },
		});

		fake.reset();

		expect(await fake.invoke('repositories.list-clones', undefined)).toEqual([]);
		await expect(
			fake.invoke('repositories.connect', {
				source: { kind: 'local-folder', path: '/tmp/hutch' },
			}),
		).resolves.toMatchObject({ id: 'fake-repo-1' });
	});
});
