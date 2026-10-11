import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import type {
	ExtensionDisposable,
	ExtensionPanelComponent,
	ExtensionPanelContext,
	ExtensionPanelRegistration,
} from '@malini/extension-api';
import { EXTENSION_EVENTS } from '@malini/extension-api';
import type { ExtensionTestHost } from '@malini/extension-api/test';
import { createTestHost } from '@malini/extension-api/test';
import { RepositoryController, type RepositoryViewState } from '../src/controller.js';
import extension from '../src/index.js';
import { activateThroughPullRequestRead, publishedSurface } from './activation.js';
import { withDom } from './dom.js';

const manifest: unknown = JSON.parse(await readFile('manifest.json', 'utf8'));

function scenarioPanelContext(): ExtensionPanelContext {
	return {
		workstream: null,
		settings: {},
		executeCommand: async () => {
			throw new Error('The scenario tests do not execute commands');
		},
	};
}

test('lists, selects, diffs, counts, refreshes, and carries repository metadata', async () => {
	const host = await createTestHost({
		manifest,
		now: 123_000,
		fixtureRepository: {
			name: 'repository-scenario',
			branch: 'feature/repository',
			baseBranch: 'main',
			files: {
				'README.md': 'malini repository extension',
				'src/index.ts': 'export const value = 1;\n',
				'.env.example': 'TOKEN=',
			},
		},
		repository: {
			status: {
				branch: 'feature/repository',
				baseBranch: 'main',
				dirtyPaths: ['src/index.ts'],
				ahead: 1,
				behind: 0,
			},
			diffs: [
				{
					path: 'src/index.ts',
					patch:
						'@@ -1,1 +1,2 @@\n-export const value = 1;\n+export const value = 2;\n+export const ready = true;',
					additions: 2,
					deletions: 1,
				},
			],
			pullRequest: {
				state: 'open',
				number: 7,
				title: 'Ship Repository extension',
				url: 'https://example.test/pull/7',
				baseBranch: 'main',
				headBranch: 'feature/repository',
				checks: 'success',
			},
		},
	});
	try {
		await activateThroughPullRequestRead(host, extension);
		let state = await host.invokeCommand<RepositoryViewState>('malini.repository.status');
		assert.equal(state.status, 'ready');
		assert.equal(state.refreshedAt, 123_000);
		assert.deepEqual(
			state.files.map(({ path }) => path),
			['README.md', 'src/index.ts'],
		);
		assert.equal(state.context?.branch, 'feature/repository');
		assert.deepEqual(state.context?.dirtyPaths, ['src/index.ts']);
		assert.equal(state.context?.ahead, 1);
		assert.equal(state.context?.pullRequest?.number, 7);
		assert.equal(state.changedFiles, 1);
		assert.equal(state.additions, 2);
		assert.equal(state.deletions, 1);

		state = await host.invokeCommand<RepositoryViewState>(
			'malini.repository.select-file',
			'src/index.ts',
		);
		assert.equal(state.selectedPath, 'src/index.ts');
		assert.equal(state.selectedContents, 'export const value = 1;\n');
		await assert.rejects(
			host.invokeCommand('malini.repository.select-file', 'missing.ts'),
			/not present/u,
		);

		state = await host.invokeCommand<RepositoryViewState>(
			'malini.repository.render-diff',
			'src/index.ts',
		);
		assert.equal(state.changedFiles, 1);
		assert.equal(state.additions, 2);
		assert.equal(state.deletions, 1);

		const repositoryReadsBeforeAgentDiff = host
			.recording()
			.filter(({ kind }) => kind === 'repository.diff').length;
		state = await host.invokeCommand<RepositoryViewState>(
			'malini.repository.open-agent-session-diff',
			{
				sessionId: 'session-1',
				path: 'src/index.ts',
				additions: 1,
				deletions: 1,
				isBinary: false,
				contributingRunIds: ['run-1'],
				net: {
					beforeCommit: '1111111',
					afterCommit: '2222222',
					capturedAt: '2026-07-22T08:00:00Z',
					patch:
						'diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;',
				},
			},
		);
		assert.equal(state.selectedPath, 'src/index.ts');
		assert.equal(state.agentSessionDiff?.sessionId, 'session-1');
		assert.equal(state.agentSessionDiff?.net.diff?.lines[0]?.text, 'export const value = 1;');
		assert.equal(
			host.recording().filter(({ kind }) => kind === 'repository.diff').length,
			repositoryReadsBeforeAgentDiff,
			'the attributed command must not reread current worktree dirt',
		);

		await host.api.settings.set('malini.repository.show-hidden', true);
		state = await host.invokeCommand<RepositoryViewState>('malini.repository.refresh');
		assert.deepEqual(
			state.files.map(({ path }) => path),
			['.env.example', 'README.md', 'src/index.ts'],
		);

		await host.api.workstream.writeFile('src/new.ts', 'new');
		state = await host.invokeCommand<RepositoryViewState>('malini.repository.refresh');
		assert.equal(
			state.files.some(({ path }) => path === 'src/new.ts'),
			true,
		);

		await host.deactivate();
		host.assertClean();
	} finally {
		await host.cleanup();
	}
});

test('activation returns with the local snapshot while the pull request is still being read', async () => {
	let finishPullRequestRead!: () => void;
	const pullRequestRead = new Promise<void>((resolve) => {
		finishPullRequestRead = resolve;
	});
	const host = await createTestHost({
		manifest,
		fixtureRepository: { name: 'slow-pull-request', files: { 'README.md': 'local first' } },
		repository: { pullRequestGate: () => pullRequestRead },
	});
	try {
		const outcome = await withinDeadline(host.activate(extension), 2_000);
		assert.equal(outcome, 'settled', 'activation must not wait for the pull request read');

		const state = await host.invokeCommand<RepositoryViewState>('malini.repository.status');
		assert.deepEqual(
			state.files.map(({ path }) => path),
			['README.md'],
		);
		assert.equal(state.pullRequestRefreshStatus, 'loading');

		const pullRequestPublished = publishedSurface(
			host,
			({ pullRequestRefreshStatus }) => pullRequestRefreshStatus === 'ready',
		);
		finishPullRequestRead();
		await pullRequestPublished.promise;
		await host.deactivate();
		host.assertClean();
	} finally {
		finishPullRequestRead();
		await host.cleanup();
	}
});

test('routes scoped refresh requests without reading unrelated repository state', async () => {
	const host = await createTestHost({
		manifest,
		fixtureRepository: {
			name: 'scoped-refresh',
			files: { 'README.md': 'Scoped repository refresh' },
		},
	});
	try {
		await activateThroughPullRequestRead(host, extension);
		assert.deepEqual(repositoryReadCounts(host.recording()), {
			refresh: 1,
			status: 1,
			diff: 2,
			pullRequest: 1,
		});

		let before = repositoryReadCounts(host.recording());
		await host.emit(EXTENSION_EVENTS.repositoryRefreshRequested, {
			workstreamId: host.workstream.id,
			scope: 'local',
		});
		assert.deepEqual(repositoryReadDelta(before, repositoryReadCounts(host.recording())), {
			refresh: 1,
			status: 1,
			diff: 2,
			pullRequest: 0,
		});

		before = repositoryReadCounts(host.recording());
		await host.emit(EXTENSION_EVENTS.repositoryRefreshRequested, {
			workstreamId: host.workstream.id,
			scope: 'pull-request',
		});
		assert.deepEqual(repositoryReadDelta(before, repositoryReadCounts(host.recording())), {
			refresh: 0,
			status: 0,
			diff: 0,
			pullRequest: 1,
		});

		before = repositoryReadCounts(host.recording());
		const pullRequestOnly = await host.invokeCommand<RepositoryViewState>(
			'malini.repository.refresh-pull-request',
		);
		assert.deepEqual(repositoryReadDelta(before, repositoryReadCounts(host.recording())), {
			refresh: 0,
			status: 0,
			diff: 0,
			pullRequest: 1,
		});
		assert.equal(pullRequestOnly.pullRequestRefreshStatus, 'ready');
		assert.notEqual(pullRequestOnly.pullRequestRefreshedAt, null);

		for (const payload of [
			{ workstreamId: host.workstream.id, scope: 'full' },
			{ workstreamId: host.workstream.id },
		] as const) {
			before = repositoryReadCounts(host.recording());
			await host.emit(EXTENSION_EVENTS.repositoryRefreshRequested, payload);
			assert.deepEqual(repositoryReadDelta(before, repositoryReadCounts(host.recording())), {
				refresh: 1,
				status: 1,
				diff: 2,
				pullRequest: 1,
			});
		}

		before = repositoryReadCounts(host.recording());
		await host.emit(EXTENSION_EVENTS.repositoryRefreshRequested, {
			workstreamId: 'another-workstream',
			scope: 'full',
		});
		await host.emit(EXTENSION_EVENTS.repositoryRefreshRequested, {
			workstreamId: host.workstream.id,
			scope: 'unsupported',
		});
		assert.deepEqual(repositoryReadDelta(before, repositoryReadCounts(host.recording())), {
			refresh: 0,
			status: 0,
			diff: 0,
			pullRequest: 0,
		});

		await host.deactivate();
		host.assertClean();
	} finally {
		await host.cleanup();
	}
});

test('persists exact PR identity and drops a stale binding before open-only discovery', async () => {
	const host = await createTestHost({
		manifest,
		fixtureRepository: {
			name: 'pull-request-binding',
			branch: 'feature/bound-pr',
			baseBranch: 'main',
			files: { 'README.md': 'bound' },
		},
		repository: {
			pullRequest: {
				state: 'open',
				number: 71,
				title: 'Bound review',
				url: 'https://example.test/pull/71',
				baseBranch: 'main',
				headBranch: 'feature/bound-pr',
				checks: 'success',
			},
		},
	});
	try {
		const scope = { kind: 'workstream' as const, id: host.workstream.id };
		await host.api.state.set(
			'pull-request-binding.v1',
			{
				version: 1,
				repositoryPath: host.workstream.repositoryPath,
				repositoryFullName: host.workstream.repositoryFullName ?? null,
				headBranch: host.workstream.branch,
				baseBranch: host.workstream.baseBranch,
				pullRequestNumber: 99,
			},
			scope,
		);
		const controller = new RepositoryController(host.api);

		assert.equal((await controller.refreshPullRequest()).context?.pullRequest?.state, 'not_open');
		assert.equal(await host.api.state.get('pull-request-binding.v1', scope), null);
		assert.equal((await controller.refreshPullRequest()).context?.pullRequest?.number, 71);

		const reads = host
			.recording()
			.filter(({ kind }) => kind === 'repository.pullRequest')
			.map(({ payload }) => (payload as { query?: unknown }).query);
		assert.deepEqual(reads.slice(-2), [{ pullRequestNumber: 99 }, null]);
		assert.deepEqual(await host.api.state.get('pull-request-binding.v1', scope), {
			version: 1,
			repositoryPath: host.workstream.repositoryPath,
			repositoryFullName: host.workstream.repositoryFullName ?? null,
			headBranch: host.workstream.branch,
			baseBranch: host.workstream.baseBranch,
			pullRequestNumber: 71,
		});
	} finally {
		await host.cleanup();
	}
});

test('switches workstream state atomically and reports malformed context', async () => {
	const host = await createTestHost({
		manifest,
		fixtureRepository: { name: 'switching', files: { 'one.txt': 'one' } },
	});
	try {
		await host.activate(extension);
		await host.emit('malini.workstream.changed', {
			id: 'workstream-2',
			path: '/tmp/workstream-2',
			repositoryPath: '/tmp/workstream-2',
			branch: 'feature/two',
			baseBranch: 'main',
		});
		let state = await host.invokeCommand<RepositoryViewState>('malini.repository.status');
		assert.equal(state.context?.workstreamId, 'workstream-2');
		assert.equal(state.status, 'idle');
		assert.deepEqual(state.files, []);
		assert.equal(state.selectedPath, null);

		await host.emit('malini.repository.context.changed', {
			workstreamId: 'workstream-2',
			repositoryPath: '/tmp/workstream-2',
			branch: '',
			baseBranch: 'main',
		});
		state = await host.invokeCommand<RepositoryViewState>('malini.repository.status');
		assert.equal(state.status, 'error');
		assert.match(state.error ?? '', /Malformed repository context: branch/u);

		await host.deactivate();
		host.assertClean();
	} finally {
		await host.cleanup();
	}
});

test('renders a deliberate empty repository state', async () => {
	const host = await createTestHost({
		manifest,
		fixtureRepository: { name: 'empty-repository', files: {} },
	});
	try {
		await host.activate(extension);
		const state = await host.invokeCommand<RepositoryViewState>('malini.repository.status');
		assert.equal(state.status, 'empty');
		assert.deepEqual(state.files, []);
		await host.deactivate();
		host.assertClean();
	} finally {
		await host.cleanup();
	}
});

test('counts a dirty path even when the repository cannot provide a textual diff', async () => {
	const host = await createTestHost({
		manifest,
		fixtureRepository: { name: 'binary-dirty-path', files: {} },
		repository: {
			status: {
				branch: 'feature/binary',
				baseBranch: 'main',
				dirtyPaths: ['assets/removed.bin'],
				ahead: 0,
				behind: 0,
			},
			diffs: [],
		},
	});
	try {
		await host.activate(extension);
		const state = await host.invokeCommand<RepositoryViewState>('malini.repository.status');
		assert.equal(state.changedFiles, 1);
		assert.deepEqual(state.context?.dirtyPaths, ['assets/removed.bin']);
		assert.deepEqual(state.diffs, []);
		await host.deactivate();
		host.assertClean();
	} finally {
		await host.cleanup();
	}
});

test('the Files tree follows the worktree across a refresh, and keeps open directories open', async () => {
	const diffs: { path: string; patch: string; additions: number; deletions: number }[] = [];
	const host = await createTestHost({
		manifest,
		fixtureRepository: {
			name: 'files-tree-refresh',
			files: {
				'README.md': '# Repository\n',
				'package.json': '{}\n',
				'src/index.ts': 'export const value = 1;\n',
				'src/legacy.ts': 'export const legacy = true;\n',
			},
		},
		repository: { diffs },
	});
	try {
		const files = await withDom(async ({ document }) => {
			const panels = capturePanelComponents(host);
			await host.activate(extension);
			const component = panels.get('malini.repository.files-panel');
			assert.ok(component, 'the extension registers a Files panel');
			const target = document.createElement('div');
			const instance = await component.mount(target, scenarioPanelContext());

			assert.deepEqual(treeRowPaths(target), ['src', 'package.json', 'README.md']);
			assert.equal(treeCount(target), '4');

			target.querySelector<HTMLButtonElement>('[data-path="src"]')?.click();
			assert.deepEqual(treeRowPaths(target), [
				'src',
				'src/index.ts',
				'src/legacy.ts',
				'package.json',
				'README.md',
			]);

			await host.api.workstream.writeFile('PARITY-CHECK.md', 'parity e2e run\n');
			await host.api.workstream.writeFile('docs/notes.md', 'notes\n');
			await rm(join(host.workstream.path, 'src/legacy.ts'));
			diffs.push(
				{
					path: 'PARITY-CHECK.md',
					patch: '@@ -0,0 +1 @@\n+parity e2e run',
					additions: 1,
					deletions: 0,
				},
				{ path: 'docs/notes.md', patch: '@@ -0,0 +1 @@\n+notes', additions: 1, deletions: 0 },
				{
					path: 'src/legacy.ts',
					patch: '@@ -1 +0,0 @@\n-export const legacy = true;',
					additions: 0,
					deletions: 1,
				},
			);

			await host.emit(EXTENSION_EVENTS.repositoryRefreshRequested, {
				workstreamId: host.workstream.id,
				scope: 'local',
			});

			const mounted = { rows: treeRowPaths(target), count: treeCount(target) };
			await instance.dispose();
			return mounted;
		});

		assert.deepEqual(files.rows, [
			'docs',
			'src',
			'src/index.ts',
			'package.json',
			'PARITY-CHECK.md',
			'README.md',
		]);
		assert.equal(files.count, '5');

		await host.deactivate();
		host.assertClean();
	} finally {
		await host.cleanup();
	}
});

function capturePanelComponents(host: ExtensionTestHost): Map<string, ExtensionPanelComponent> {
	const components = new Map<string, ExtensionPanelComponent>();
	const panels = host.api.panels as {
		register(panel: ExtensionPanelRegistration): ExtensionDisposable;
	};
	const register = panels.register.bind(panels);
	panels.register = (panel) => {
		components.set(panel.id, panel.component);
		return register(panel);
	};
	return components;
}

function treeRowPaths(target: HTMLElement): string[] {
	return [...target.querySelectorAll<HTMLElement>('.repository-panel__tree > [data-path]')].map(
		(row) => row.dataset.path ?? '',
	);
}

function treeCount(target: HTMLElement): string {
	return (
		target.querySelector<HTMLElement>(
			'.repository-panel__files-section--all .repository-panel__section-summary',
		)?.textContent ?? ''
	);
}

type RepositoryReadCounts = Readonly<{
	refresh: number;
	status: number;
	diff: number;
	pullRequest: number;
}>;

function repositoryReadCounts(recording: readonly { kind: string }[]): RepositoryReadCounts {
	return {
		refresh: recording.filter(({ kind }) => kind === 'repository.refresh').length,
		status: recording.filter(({ kind }) => kind === 'repository.status').length,
		diff: recording.filter(({ kind }) => kind === 'repository.diff').length,
		pullRequest: recording.filter(({ kind }) => kind === 'repository.pullRequest').length,
	};
}

function repositoryReadDelta(
	before: RepositoryReadCounts,
	after: RepositoryReadCounts,
): RepositoryReadCounts {
	return {
		refresh: after.refresh - before.refresh,
		status: after.status - before.status,
		diff: after.diff - before.diff,
		pullRequest: after.pullRequest - before.pullRequest,
	};
}

async function withinDeadline(
	operation: Promise<unknown>,
	deadlineMs: number,
): Promise<'settled' | 'timed out'> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<'timed out'>((resolve) => {
		timer = setTimeout(() => resolve('timed out'), deadlineMs);
	});
	const settled = (async (): Promise<'settled'> => {
		await operation;
		return 'settled';
	})();
	try {
		return await Promise.race([settled, deadline]);
	} finally {
		clearTimeout(timer);
	}
}
