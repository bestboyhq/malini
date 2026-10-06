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
import {
	RepositoryController,
	type RepositoryPullRequestFixContext,
	type RepositoryViewState,
} from '../src/controller.js';
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

test('loads diagnostic bodies only through the explicit prepare-fix command', async () => {
	const headSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
	const host = await createTestHost({
		manifest,
		fixtureRepository: {
			name: 'pull-request-fix-diagnostics',
			files: { 'README.md': 'Fix diagnostics' },
		},
		repository: {
			pullRequest: {
				state: 'open',
				number: 42,
				title: 'Fix failed checks',
				url: 'https://example.test/pull/42',
				headSha,
				checks: 'failed',
			},
			reviewFeedback: {
				unresolvedThreads: [],
				unresolvedThreadsComplete: true,
				requestedChangeReviews: [],
				requestedChangeReviewsComplete: true,
				truncated: false,
			},
			checkDiagnostics: {
				checkRuns: [],
				checkRunsComplete: true,
				commitStatuses: [],
				commitStatusesComplete: true,
				truncated: false,
			},
		},
	});
	try {
		await host.activate(extension);
		assert.equal(
			host.recording().some(({ kind }) => kind === 'repository.pullRequestReviewFeedback'),
			false,
		);
		assert.equal(
			host.recording().some(({ kind }) => kind === 'repository.pullRequestCheckDiagnostics'),
			false,
		);

		const prepared = await host.invokeCommand<RepositoryPullRequestFixContext>(
			'malini.repository.prepare-pull-request-fix',
		);
		assert.equal(prepared.pullRequestNumber, 42);
		assert.equal(prepared.headSha, headSha);
		assert.deepEqual(prepared.reviewFeedback?.unresolvedThreads, []);
		assert.deepEqual(prepared.checkDiagnostics?.checkRuns, []);
		assert.equal(JSON.stringify(prepared.state).includes('unresolvedThreads'), false);
		assert.equal(
			host.recording().filter(({ kind }) => kind === 'repository.pullRequestReviewFeedback').length,
			1,
		);
		assert.equal(
			host.recording().filter(({ kind }) => kind === 'repository.pullRequestCheckDiagnostics')
				.length,
			1,
		);
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

test('creates a pull request in one click with automatic metadata and no external navigation', async () => {
	const host = await createTestHost({
		manifest,
		fixtureRepository: {
			name: 'pull-request',
			branch: 'feature/review-flow',
			baseBranch: 'main',
			files: { 'src/index.ts': 'changed' },
		},
		repository: {
			status: {
				branch: 'feature/review-flow',
				baseBranch: 'main',
				dirtyPaths: ['src/index.ts'],
				ahead: 0,
				behind: 0,
			},
			pullRequest: {
				state: 'not_open',
				number: 42,
				title: null,
				url: 'https://example.test/pull/42',
				baseBranch: 'main',
				headBranch: 'feature/review-flow',
				checks: 'unknown',
			},
		},
	});
	try {
		await host.activate(extension);
		const state = await host.invokeCommand<RepositoryViewState>(
			'malini.repository.create-or-open-pull-request',
			{
				draft: true,
				context: {
					sessionTitle: 'Automate review flow',
					lastUserIntent: 'Create the review flow without asking for metadata.',
					runSummaries: ['Implemented the automatic review flow.'],
					events: [{ kind: 'validation', label: 'Repository tests', status: 'passed' }],
				},
			},
		);
		assert.equal(state.context?.pullRequest?.state, 'draft');
		assert.equal(state.context?.pullRequest?.number, 42);
		assert.deepEqual(
			host
				.recording()
				.filter(({ kind }) =>
					['repository.commit', 'repository.push', 'repository.createPullRequest'].includes(kind),
				)
				.map(({ kind }) => kind),
			['repository.commit', 'repository.push', 'repository.createPullRequest'],
		);
		assert.deepEqual(host.recording().find(({ kind }) => kind === 'repository.commit')?.payload, {
			message: 'Implemented the automatic review flow',
		});
		const creation = host.recording().find(({ kind }) => kind === 'repository.createPullRequest');
		const creationPayload = creation?.payload as { input?: unknown } | undefined;
		assert.deepEqual(creationPayload?.input, {
			title: 'Implemented the automatic review flow',
			body: [
				'## Summary',
				'',
				'Implemented the automatic review flow.',
				'',
				'Publish `feature/review-flow` against `main`.',
				'',
				'- `src/index.ts`',
				'',
				'## Validation',
				'',
				'- Passed - Validation: Repository tests',
			].join('\n'),
			draft: true,
			baseBranch: 'main',
		});
		assert.equal(
			host.recording().some(({ kind }) => kind === 'ui.openExternal'),
			false,
		);
		await host.deactivate();
		host.assertClean();
	} finally {
		await host.cleanup();
	}
});

test('keeps an existing pull request inside malini without mutating or opening a browser', async () => {
	const host = await createTestHost({
		manifest,
		fixtureRepository: { name: 'existing-pull-request', files: { 'README.md': 'ready' } },
		repository: {
			pullRequest: {
				state: 'open',
				number: 8,
				title: 'Already open',
				url: 'https://example.test/pull/8',
				baseBranch: 'main',
				headBranch: 'feature/test',
				checks: 'success',
			},
		},
	});
	try {
		await host.activate(extension);
		await host.invokeCommand('malini.repository.create-or-open-pull-request');
		assert.equal(
			host
				.recording()
				.some(({ kind }) =>
					['repository.commit', 'repository.push', 'repository.createPullRequest'].includes(kind),
				),
			false,
		);
		assert.equal(
			host.recording().some(({ kind }) => kind === 'ui.openExternal'),
			false,
		);
		assert.equal(
			(await host.invokeCommand<RepositoryViewState>('malini.repository.status')).context
				?.pullRequest?.number,
			8,
		);
		await host.deactivate();
		host.assertClean();
	} finally {
		await host.cleanup();
	}
});

test('automatically commits and pushes an existing pull request without user-entered metadata', async () => {
	const host = await createTestHost({
		manifest,
		fixtureRepository: {
			name: 'existing-dirty-pull-request',
			branch: 'feature/existing-dirty',
			baseBranch: 'main',
			files: { 'src/changed.ts': 'changed' },
		},
		repository: {
			status: {
				branch: 'feature/existing-dirty',
				baseBranch: 'main',
				dirtyPaths: ['src/changed.ts'],
				ahead: 0,
				behind: 0,
			},
			pullRequest: {
				state: 'open',
				number: 18,
				title: 'Existing review',
				url: 'https://example.test/pull/18',
				baseBranch: 'main',
				headBranch: 'feature/existing-dirty',
				checks: 'pending',
			},
		},
	});
	try {
		await host.activate(extension);
		await host.invokeCommand('malini.repository.create-or-open-pull-request', {
			context: { sessionTitle: 'Update existing review' },
		});
		assert.deepEqual(
			host
				.recording()
				.filter(({ kind }) =>
					['repository.commit', 'repository.push', 'repository.createPullRequest'].includes(kind),
				)
				.map(({ kind }) => kind),
			['repository.commit', 'repository.push'],
		);
		assert.deepEqual(host.recording().find(({ kind }) => kind === 'repository.commit')?.payload, {
			message: 'Update changed',
		});
		await host.deactivate();
		host.assertClean();
	} finally {
		await host.cleanup();
	}
});

test('pulls the target branch and pushes the updated workstream before refreshing PR state', async () => {
	const host = await createTestHost({
		manifest,
		fixtureRepository: {
			name: 'behind-pull-request',
			branch: 'feature/behind',
			baseBranch: 'main',
			files: { 'README.md': 'behind' },
		},
		repository: {
			status: {
				branch: 'feature/behind',
				baseBranch: 'main',
				dirtyPaths: [],
				ahead: 1,
				behind: 0,
			},
			pullRequest: {
				state: 'open',
				number: 1149,
				title: 'Catch up',
				url: 'https://example.test/pull/1149',
				baseBranch: 'main',
				headBranch: 'feature/behind',
				headSha: 'head-1149',
				mergeable: true,
				mergeableState: 'behind',
				checks: 'success',
			},
		},
	});
	try {
		const controller = new RepositoryController(host.api);
		await controller.refresh();
		await controller.pullLatest();
		assert.deepEqual(
			host
				.recording()
				.filter(({ kind }) =>
					['repository.pullLatest', 'repository.push', 'repository.refresh'].includes(kind),
				)
				.slice(-3)
				.map(({ kind }) => kind),
			['repository.pullLatest', 'repository.push', 'repository.refresh'],
		);
		assert.deepEqual(
			host.recording().find(({ kind }) => kind === 'repository.pullLatest')?.payload,
			{ baseBranch: 'main' },
		);
	} finally {
		await host.cleanup();
	}
});

test('pull-latest proceeds when behindBase > 0 and GitHub does not report BEHIND', async () => {
	const host = await createTestHost({
		manifest,
		fixtureRepository: {
			name: 'behind-base-pull-request',
			branch: 'feature/ahead',
			baseBranch: 'main',
			files: { 'README.md': 'ahead' },
		},
		repository: {
			status: {
				branch: 'feature/ahead',
				baseBranch: 'main',
				dirtyPaths: [],
				ahead: 1,
				behind: 0,
			},
			pullRequest: {
				state: 'open',
				number: 200,
				title: 'Behind base',
				url: 'https://example.test/pull/200',
				baseBranch: 'main',
				headBranch: 'feature/ahead',
				headSha: 'head-200',
				mergeable: true,
				mergeableState: 'clean',
				checks: 'success',
				behindBase: 2,
			},
		},
	});
	try {
		const controller = new RepositoryController(host.api);
		await controller.refresh();
		await controller.pullLatest();
		assert.deepEqual(
			host
				.recording()
				.filter(({ kind }) =>
					['repository.pullLatest', 'repository.push', 'repository.refresh'].includes(kind),
				)
				.slice(-3)
				.map(({ kind }) => kind),
			['repository.pullLatest', 'repository.push', 'repository.refresh'],
		);
		assert.deepEqual(
			host.recording().find(({ kind }) => kind === 'repository.pullLatest')?.payload,
			{ baseBranch: 'main' },
		);
	} finally {
		await host.cleanup();
	}
});

test('pull-latest refuses when behindBase is 0 and GitHub does not report BEHIND', async () => {
	const host = await createTestHost({
		manifest,
		fixtureRepository: {
			name: 'not-behind-pull-request',
			branch: 'feature/clean',
			baseBranch: 'main',
			files: { 'README.md': 'clean' },
		},
		repository: {
			status: {
				branch: 'feature/clean',
				baseBranch: 'main',
				dirtyPaths: [],
				ahead: 1,
				behind: 0,
			},
			pullRequest: {
				state: 'open',
				number: 201,
				title: 'Not behind',
				url: 'https://example.test/pull/201',
				baseBranch: 'main',
				headBranch: 'feature/clean',
				headSha: 'head-201',
				mergeable: true,
				mergeableState: 'clean',
				checks: 'success',
				behindBase: 0,
			},
		},
	});
	try {
		const controller = new RepositoryController(host.api);
		await controller.refresh();
		await assert.rejects(controller.pullLatest());
	} finally {
		await host.cleanup();
	}
});

test('marks a draft ready, merges it with the known head SHA, and refreshes after each action', async () => {
	const host = await createTestHost({
		manifest,
		fixtureRepository: { name: 'pull-request-mutations', files: { 'README.md': 'ready' } },
		repository: {
			supportsPullRequestMutations: true,
			pullRequest: {
				state: 'draft',
				number: 42,
				title: 'Ship it',
				url: 'https://example.test/pull/42',
				baseBranch: 'main',
				headBranch: 'feature/test',
				headSha: 'head-42',
				mergeable: true,
				mergeableState: 'clean',
				checks: 'success',
			},
		},
	});
	try {
		await host.activate(extension);
		const controller = new RepositoryController(host.api);
		await controller.refresh();
		const refreshesBeforeMutations = host
			.recording()
			.filter(({ kind }) => kind === 'repository.refresh').length;
		assert.equal(
			(await controller.markPullRequestReadyForReview()).context?.pullRequest?.state,
			'open',
		);
		assert.equal(
			(await controller.mergePullRequest(undefined, 'head-42')).context?.pullRequest?.state,
			'merged',
		);
		assert.deepEqual(
			host.recording().find(({ kind }) => kind === 'repository.mergePullRequest')?.payload,
			{
				input: { number: 42, expectedHeadSha: 'head-42', mergeMethod: 'squash' },
				context: {
					state: 'merged',
					number: 42,
					title: 'Ship it',
					url: 'https://example.test/pull/42',
					baseBranch: 'main',
					headBranch: 'feature/test',
					headSha: 'head-42',
					mergeable: true,
					mergeableState: 'clean',
					behindBase: null,
					checks: 'success',
					checkItems: [],
					viewerCanMerge: true,
					allowedMergeMethods: ['squash'],
					defaultMergeMethod: null,
					reviewDecision: null,
					unresolvedReviewThreadCount: 0,
				},
			},
		);
		assert.equal(
			host.recording().filter(({ kind }) => kind === 'repository.refresh').length,
			refreshesBeforeMutations + 2,
		);
		await host.deactivate();
		host.assertClean();
	} finally {
		await host.cleanup();
	}
});

test('merges a clean open pull request when GitHub confirms that no checks exist', async () => {
	const host = await createTestHost({
		manifest,
		fixtureRepository: {
			name: 'pull-request-without-ci',
			branch: 'feature/no-ci',
			files: { 'README.md': 'ready' },
		},
		repository: {
			supportsPullRequestMutations: true,
			pullRequest: {
				state: 'open',
				number: 43,
				title: 'Ship without CI',
				url: 'https://example.test/pull/43',
				baseBranch: 'main',
				headBranch: 'feature/no-ci',
				headSha: 'head-43',
				mergeable: true,
				mergeableState: 'clean',
				checks: 'none',
			},
		},
	});
	try {
		const controller = new RepositoryController(host.api);
		await controller.refresh();

		const merged = await controller.mergePullRequest(undefined, 'head-43');
		assert.equal(merged.context?.pullRequest?.state, 'merged');
		assert.equal(merged.context?.pullRequest?.checks, 'none');
		assert.deepEqual(
			host.recording().find(({ kind }) => kind === 'repository.mergePullRequest')?.payload,
			{
				input: { number: 43, expectedHeadSha: 'head-43', mergeMethod: 'squash' },
				context: {
					state: 'merged',
					number: 43,
					title: 'Ship without CI',
					url: 'https://example.test/pull/43',
					baseBranch: 'main',
					headBranch: 'feature/no-ci',
					headSha: 'head-43',
					mergeable: true,
					mergeableState: 'clean',
					behindBase: null,
					checks: 'none',
					checkItems: [],
					viewerCanMerge: true,
					allowedMergeMethods: ['squash'],
					defaultMergeMethod: null,
					reviewDecision: null,
					unresolvedReviewThreadCount: 0,
				},
			},
		);
	} finally {
		await host.cleanup();
	}
});

test('refuses merge when checks are pending, failed, or unknown', async (t) => {
	for (const checks of ['pending', 'failed', 'unknown'] as const) {
		await t.test(checks, async () => {
			const host = await createTestHost({
				manifest,
				fixtureRepository: { name: `pull-request-${checks}`, files: { 'README.md': 'ready' } },
				repository: {
					supportsPullRequestMutations: true,
					pullRequest: {
						state: 'open',
						number: 42,
						title: 'Checks are not safe',
						url: 'https://example.test/pull/42',
						baseBranch: 'main',
						headBranch: 'feature/test',
						mergeable: true,
						mergeableState: 'clean',
						checks,
					},
				},
			});
			try {
				const controller = new RepositoryController(host.api);
				await controller.refresh();
				await assert.rejects(
					controller.mergePullRequest(undefined, 'head-42'),
					/checks must pass/u,
				);
				assert.equal(
					host.recording().some(({ kind }) => kind === 'repository.mergePullRequest'),
					false,
				);
			} finally {
				await host.cleanup();
			}
		});
	}
});

test('refuses merge while GitHub reports blockers or is still computing mergeability', async (t) => {
	for (const scenario of [
		{
			name: 'blocked by GitHub',
			mergeable: true,
			mergeableState: 'blocked',
			error: /blocked from merging/u,
		},
		{
			name: 'mergeability pending',
			mergeable: null,
			mergeableState: 'unknown',
			error: /still computing/u,
		},
	] as const) {
		await t.test(scenario.name, async () => {
			const host = await createTestHost({
				manifest,
				fixtureRepository: { name: scenario.name, files: { 'README.md': 'ready' } },
				repository: {
					supportsPullRequestMutations: true,
					pullRequest: {
						state: 'open',
						number: 42,
						title: 'Blocked',
						url: 'https://example.test/pull/42',
						baseBranch: 'main',
						headBranch: 'feature/test',
						headSha: 'head-42',
						mergeable: scenario.mergeable,
						mergeableState: scenario.mergeableState,
						checks: 'success',
					},
				},
			});
			try {
				const controller = new RepositoryController(host.api);
				await controller.refresh();
				await assert.rejects(controller.mergePullRequest(undefined, 'head-42'), scenario.error);
				assert.equal(
					host.recording().some(({ kind }) => kind === 'repository.mergePullRequest'),
					false,
				);
			} finally {
				await host.cleanup();
			}
		});
	}
});

test('fails closed on detailed check, review, permission, and merge-method blockers', async (t) => {
	const requiredFailure = {
		name: 'Unit tests',
		appId: 15_368,
		state: 'completed',
		conclusion: 'failure',
		required: true,
		url: 'https://example.test/check/unit',
		startedAt: '2026-07-22T08:00:00Z',
		completedAt: '2026-07-22T08:01:00Z',
	} as const;
	for (const scenario of [
		{
			name: 'required check failure',
			overrides: { checkItems: [requiredFailure], checks: 'success' as const },
			error: /checks must pass/u,
		},
		{
			name: 'requested changes',
			overrides: { reviewDecision: 'changes_requested' as const },
			error: /review threads/u,
		},
		{
			name: 'unknown review threads',
			overrides: { unresolvedReviewThreadCount: null },
			error: /review thread status is unavailable/u,
		},
		{
			name: 'missing viewer permission',
			overrides: { viewerCanMerge: false },
			error: /permission/u,
		},
		{
			name: 'no enabled merge method',
			overrides: { allowedMergeMethods: [] },
			error: /available merge method/u,
		},
	] as const) {
		await t.test(scenario.name, async () => {
			const host = await createTestHost({
				manifest,
				fixtureRepository: {
					name: `pull-request-${scenario.name}`,
					branch: 'feature/test',
					files: { 'README.md': 'ready' },
				},
				repository: {
					supportsPullRequestMutations: true,
					pullRequest: {
						state: 'open',
						number: 42,
						title: 'Protected merge',
						url: 'https://example.test/pull/42',
						baseBranch: 'main',
						headBranch: 'feature/test',
						headSha: 'head-42',
						mergeable: true,
						mergeableState: 'clean',
						checks: 'success',
						viewerCanMerge: true,
						allowedMergeMethods: ['squash'],
						unresolvedReviewThreadCount: 0,
						...scenario.overrides,
					},
				},
			});
			try {
				const controller = new RepositoryController(host.api);
				await controller.refresh();
				await assert.rejects(controller.mergePullRequest(undefined, 'head-42'), scenario.error);
				assert.equal(
					host.recording().some(({ kind }) => kind === 'repository.mergePullRequest'),
					false,
				);
			} finally {
				await host.cleanup();
			}
		});
	}

	const host = await createTestHost({
		manifest,
		fixtureRepository: {
			name: 'pull-request-stale-method',
			branch: 'feature/test',
			files: { 'README.md': 'ready' },
		},
		repository: {
			supportsPullRequestMutations: true,
			pullRequest: {
				state: 'open',
				number: 42,
				title: 'Protected merge',
				url: 'https://example.test/pull/42',
				baseBranch: 'main',
				headBranch: 'feature/test',
				headSha: 'head-42',
				mergeable: true,
				mergeableState: 'clean',
				checks: 'success',
				viewerCanMerge: true,
				allowedMergeMethods: ['squash'],
				unresolvedReviewThreadCount: 0,
			},
		},
	});
	try {
		const controller = new RepositoryController(host.api);
		await controller.refresh();
		await assert.rejects(
			controller.mergePullRequest('rebase', 'head-42'),
			/selected merge method/u,
		);
	} finally {
		await host.cleanup();
	}
});

test('refreshes pull request status internally when the host does not expose native mutations', async () => {
	const host = await createTestHost({
		manifest,
		fixtureRepository: { name: 'pull-request-fallback', files: { 'README.md': 'ready' } },
		repository: {
			pullRequest: {
				state: 'draft',
				number: 42,
				title: 'Ship it',
				url: 'https://example.test/pull/42',
				baseBranch: 'main',
				headBranch: 'feature/test',
				checks: 'unknown',
			},
		},
	});
	try {
		const controller = new RepositoryController(host.api);
		await controller.markPullRequestReadyForReview();
		assert.equal(
			host.recording().some(({ kind }) => kind === 'ui.openExternal'),
			false,
		);
		assert.equal(
			host.recording().filter(({ kind }) => kind === 'repository.pullRequest').length,
			1,
		);
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
