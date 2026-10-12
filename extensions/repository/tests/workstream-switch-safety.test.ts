import assert from 'node:assert/strict';
import test from 'node:test';
import type {
	ExtensionPullRequestContext,
	ExtensionPullRequestQuery,
	ExtensionRepositoryDiff,
	ExtensionRepositoryStatus,
	ExtensionSettingScope,
	ExtensionWorkstream,
} from '@malini/extension-api';
import { RepositoryController, type RepositoryViewState } from '../src/controller.js';

const firstWorkstream = workstream('workstream-a', 'feature/a');
const secondWorkstream = workstream('workstream-b', 'feature/b');

test('a late local refresh preserves pull request state from a newer scoped refresh', async () => {
	const localRefresh = deferred<void>();
	const harness = createHarness({
		refresh: () => localRefresh.promise,
		listFiles: () => Promise.resolve(['src/new.ts']),
		status: () => Promise.resolve(repositoryStatus({ dirtyPaths: ['src/new.ts'], ahead: 3 })),
		diff: () =>
			Promise.resolve([
				{
					path: 'src/new.ts',
					patch: '@@ -0,0 +1 @@\n+new',
					additions: 1,
					deletions: 0,
				},
			]),
		pullRequest: () => Promise.resolve(pullRequest({ number: 84, title: 'New pull request' })),
	});
	const localOperation = harness.controller.refreshLocal();

	await waitForCall(harness.calls, 'refresh');
	const pullRequestState = await harness.controller.refreshPullRequest();
	assert.equal(pullRequestState.context?.pullRequest?.number, 84);
	localRefresh.resolve();

	const state = await localOperation;
	assert.equal(state.context?.pullRequest?.number, 84);
	assert.deepEqual(state.context?.dirtyPaths, ['src/new.ts']);
	assert.equal(state.context?.ahead, 3);
	assert.equal(state.changedFiles, 1);
	assert.equal(state.additions, 1);
	assert.deepEqual(
		harness.calls
			.filter(({ kind }) => kind === 'pull-request')
			.map(({ workstreamId }) => workstreamId),
		[firstWorkstream.id],
	);
});

test('a late pull request refresh preserves local state from a newer scoped refresh', async () => {
	const pullRequestRefresh = deferred<ExtensionPullRequestContext>();
	const harness = createHarness({
		pullRequest: () => pullRequestRefresh.promise,
		listFiles: () => Promise.resolve(['src/local.ts']),
		status: () => Promise.resolve(repositoryStatus({ dirtyPaths: ['src/local.ts'], behind: 2 })),
		diff: () =>
			Promise.resolve([
				{
					path: 'src/local.ts',
					patch: '@@ -1 +1 @@\n-old\n+local',
					additions: 1,
					deletions: 1,
				},
			]),
	});
	const pullRequestOperation = harness.controller.refreshPullRequest();

	await waitForCall(harness.calls, 'pull-request');
	const localState = await harness.controller.refreshLocal();
	assert.deepEqual(localState.context?.dirtyPaths, ['src/local.ts']);
	assert.equal(localState.context?.behind, 2);
	pullRequestRefresh.resolve(pullRequest({ number: 96, title: 'Late pull request' }));

	const state = await pullRequestOperation;
	assert.equal(state.context?.pullRequest?.number, 96);
	assert.deepEqual(state.context?.dirtyPaths, ['src/local.ts']);
	assert.equal(state.context?.behind, 2);
	assert.equal(state.changedFiles, 1);
	assert.equal(state.deletions, 1);
});

test('a current local failure remains visible when a newer pull request refresh succeeds', async () => {
	const localRefresh = deferred<void>();
	const harness = createHarness({
		refresh: () => localRefresh.promise,
		pullRequest: () => Promise.resolve(pullRequest({ number: 97, title: 'Fresh PR state' })),
	});
	const localOperation = harness.controller.refreshLocal();

	await waitForCall(harness.calls, 'refresh');
	const pullRequestState = await harness.controller.refreshPullRequest();
	assert.equal(pullRequestState.context?.pullRequest?.number, 97);
	localRefresh.reject(new Error('temporary Git index lock'));

	const state = await localOperation;
	assert.equal(state.status, 'error');
	assert.equal(state.error, 'temporary Git index lock');
	assert.equal(state.context?.pullRequest?.number, 97);
});

test('a pull request refresh failure survives unrelated local and file successes until PR retry', async () => {
	let pullRequestReads = 0;
	const harness = createHarness({
		listFiles: () => Promise.resolve(['src/app.ts']),
		pullRequest: () => {
			pullRequestReads += 1;
			return pullRequestReads === 1
				? Promise.reject(new Error('checks endpoint unavailable'))
				: Promise.resolve(pullRequest({ number: 77, title: 'Recovered checks' }));
		},
	});

	let state = await harness.controller.refreshPullRequest();
	assert.equal(state.pullRequestRefreshStatus, 'error');
	assert.equal(state.pullRequestError, 'checks endpoint unavailable');
	assert.equal(state.error, 'checks endpoint unavailable');

	state = await harness.controller.refreshLocal();
	assert.equal(state.status, 'ready');
	assert.equal(state.pullRequestRefreshStatus, 'error');
	assert.equal(state.pullRequestError, 'checks endpoint unavailable');
	assert.equal(state.error, 'checks endpoint unavailable');

	state = await harness.controller.selectFile('src/app.ts');
	assert.equal(state.pullRequestError, 'checks endpoint unavailable');
	assert.equal(state.error, 'checks endpoint unavailable');

	state = await harness.controller.refreshPullRequest();
	assert.equal(state.pullRequestRefreshStatus, 'ready');
	assert.equal(state.pullRequestError, null);
	assert.equal(state.error, null);
	assert.equal(state.context?.pullRequest?.number, 77);
});

test('an older pull request read cannot overwrite a newer pull request refresh', async () => {
	const olderPullRequest = deferred<ExtensionPullRequestContext>();
	let pullRequestReads = 0;
	const harness = createHarness({
		pullRequest: () => {
			pullRequestReads += 1;
			return pullRequestReads === 1
				? olderPullRequest.promise
				: Promise.resolve(pullRequest({ number: 202, title: 'Newest pull request' }));
		},
	});
	const olderOperation = harness.controller.refreshPullRequest();

	await waitForCall(harness.calls, 'pull-request');
	const newerState = await harness.controller.refreshPullRequest();
	assert.equal(newerState.context?.pullRequest?.number, 202);
	olderPullRequest.resolve(pullRequest({ number: 101, title: 'Stale pull request' }));

	const state = await olderOperation;
	assert.equal(state.context?.pullRequest?.number, 202);
	assert.equal(state.context?.pullRequest?.title, 'Newest pull request');
});

test('an older local snapshot cannot overwrite a newer local refresh', async () => {
	const olderRefresh = deferred<void>();
	let refreshRequests = 0;
	const newest = (): boolean => refreshRequests > 1;
	const harness = createHarness({
		refresh: () => {
			refreshRequests += 1;
			return refreshRequests === 1 ? olderRefresh.promise : Promise.resolve();
		},
		listFiles: () => Promise.resolve([newest() ? 'src/newest.ts' : 'src/stale.ts']),
		status: () => Promise.resolve(repositoryStatus({ ahead: newest() ? 22 : 11 })),
		diff: () =>
			Promise.resolve([
				{
					path: newest() ? 'src/newest.ts' : 'src/stale.ts',
					patch: '@@ -0,0 +1 @@\n+change',
					additions: newest() ? 22 : 11,
					deletions: 0,
				},
			]),
	});
	const olderOperation = harness.controller.refreshLocal();

	await waitForCall(harness.calls, 'refresh');
	const newerState = await harness.controller.refreshLocal();
	assert.equal(newerState.context?.ahead, 22);
	assert.equal(newerState.files[0]?.path, 'src/newest.ts');
	assert.equal(newerState.additions, 22);
	olderRefresh.resolve();

	const state = await olderOperation;
	assert.equal(state.context?.ahead, 22);
	assert.equal(state.files[0]?.path, 'src/newest.ts');
	assert.equal(state.additions, 22);
});

test('a refresh overtaken by a newer local refresh waits for it instead of returning a loading snapshot', async () => {
	const newerRefresh = deferred<void>();
	let refreshRequests = 0;
	let statusReads = 0;
	const harness = createHarness({
		refresh: () => {
			refreshRequests += 1;
			return refreshRequests === 2 ? newerRefresh.promise : Promise.resolve();
		},
		status: () => {
			statusReads += 1;
			return Promise.resolve(repositoryStatus({ ahead: statusReads === 1 ? 11 : 22 }));
		},
	});
	const olderOperation = harness.controller.refreshLocal();
	const newerOperation = harness.controller.refreshLocal();
	await waitForCallCount(harness.calls, 'refresh', 2);
	let olderSettled = false;
	void (async () => {
		await olderOperation;
		olderSettled = true;
	})();
	for (let turn = 0; turn < 20; turn += 1) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	assert.equal(olderSettled, false);

	newerRefresh.resolve();
	const state = await olderOperation;
	assert.notEqual(state.status, 'loading');
	assert.equal(state.context?.ahead, 22);
	assert.deepEqual(await newerOperation, state);
});

test('selecting one diff preserves the repository-wide change list and totals', async () => {
	const allDiffs: readonly ExtensionRepositoryDiff[] = [
		{
			path: 'src/first.ts',
			patch: '@@ -0,0 +1,2 @@\n+first\n+second',
			additions: 2,
			deletions: 0,
		},
		{
			path: 'src/second.ts',
			patch: '@@ -1 +1 @@\n-old\n+new',
			additions: 1,
			deletions: 1,
		},
	];
	const harness = createHarness({
		diff: (_workstreamId, path) =>
			Promise.resolve(path ? allDiffs.filter((diff) => diff.path === path) : allDiffs),
	});

	await harness.controller.refreshLocal();
	const state = await harness.controller.loadDiff('src/second.ts');

	assert.equal(state.diff?.path, 'src/second.ts');
	assert.deepEqual(
		state.diffs.map(({ path }) => path),
		['src/first.ts', 'src/second.ts'],
	);
	assert.equal(state.changedFiles, 2);
	assert.equal(state.additions, 3);
	assert.equal(state.deletions, 1);
});

test('publishes a current local mutation failure before rejecting the command', async () => {
	const harness = createHarness({
		abortOperation: () => Promise.reject(new Error('no merge to abort')),
	});

	await assert.rejects(harness.controller.abortOperation(), /no merge to abort/u);
	const state = harness.controller.snapshot();

	assert.equal(state.status, 'error');
	assert.equal(state.localError, 'no merge to abort');
	assert.equal(state.pullRequestError, null);
	assert.equal(state.error, 'no merge to abort');
	assert.deepEqual(
		harness.calls.filter(({ kind }) => kind === 'refresh'),
		[],
	);
});

test('does not publish a full refresh that finishes after a workstream switch', async () => {
	const status = deferred<ExtensionRepositoryStatus>();
	const pullRequestRefresh = deferred<ExtensionPullRequestContext>();
	const harness = createHarness({
		status: () => status.promise,
		pullRequest: () => pullRequestRefresh.promise,
	});
	const operation = harness.controller.refresh();

	await waitForCall(harness.calls, 'status');
	await waitForCall(harness.calls, 'pull-request');
	const statesAfterSwitch = harness.switchWorkstream(secondWorkstream);
	status.resolve(repositoryStatus({ dirtyPaths: ['src/stale.ts'] }));
	pullRequestRefresh.resolve(pullRequest({ number: 404, title: 'Stale refresh' }));

	const result = await operation;
	assert.equal(result.context?.workstreamId, secondWorkstream.id);
	assertStatesBelongTo(statesAfterSwitch(), secondWorkstream.id);
});

test('does not continue an operation after the same workstream receives a new repository revision', async () => {
	const abort = deferred<void>();
	const harness = createHarness({ abortOperation: () => abort.promise });
	const operation = harness.controller.abortOperation();

	await waitForCall(harness.calls, 'abort-operation');
	harness.controller.setRepositoryContext({
		workstreamId: firstWorkstream.id,
		repositoryPath: firstWorkstream.repositoryPath,
		repositoryFullName: firstWorkstream.repositoryFullName,
		branch: 'feature/rebased',
		baseBranch: 'release',
		dirtyPaths: [],
		ahead: 0,
		behind: 0,
		pullRequest: null,
	});
	abort.resolve();

	const state = await operation;
	assert.equal(state.context?.branch, 'feature/rebased');
	assert.equal(state.context?.baseBranch, 'release');
	assert.deepEqual(
		harness.calls.filter(({ kind }) => kind === 'refresh'),
		[],
	);
});

test('does not publish a mutation rejection after the same workstream is rebound', async () => {
	const abort = deferred<void>();
	const harness = createHarness({ abortOperation: () => abort.promise });
	const operation = harness.controller.abortOperation();

	await waitForCall(harness.calls, 'abort-operation');
	harness.controller.setRepositoryContext({
		workstreamId: firstWorkstream.id,
		repositoryPath: firstWorkstream.repositoryPath,
		repositoryFullName: firstWorkstream.repositoryFullName,
		branch: 'feature/rebound-after-failure',
		baseBranch: 'release',
		dirtyPaths: [],
		ahead: 0,
		behind: 0,
		pullRequest: null,
	});
	abort.reject(new Error('old revision abort failed'));

	const state = await operation;
	assert.equal(state.context?.branch, 'feature/rebound-after-failure');
	assert.equal(state.localError, null);
	assert.equal(state.error, null);
});

test('keeps an explicit same-workstream repository context through the next local refresh', async () => {
	const harness = createHarness();
	harness.controller.setRepositoryContext({
		workstreamId: firstWorkstream.id,
		repositoryPath: '/tmp/workstream-a-rebound',
		repositoryFullName: 'acme/workstream-a-rebound',
		branch: 'feature/rebound',
		baseBranch: 'release',
		dirtyPaths: [],
		ahead: 0,
		behind: 0,
		pullRequest: null,
	});

	const state = await harness.controller.refreshLocal();

	assert.equal(state.context?.repositoryPath, '/tmp/workstream-a-rebound');
	assert.equal(state.context?.repositoryFullName, 'acme/workstream-a-rebound');
	assert.equal(state.context?.branch, firstWorkstream.branch);
	assert.equal(state.context?.baseBranch, firstWorkstream.baseBranch);
});

test('does not refresh the next workstream when an old abort finishes late', async () => {
	const abort = deferred<void>();
	const harness = createHarness({ abortOperation: () => abort.promise });
	const operation = harness.controller.abortOperation();

	await waitForCall(harness.calls, 'abort-operation');
	const statesAfterSwitch = harness.switchWorkstream(secondWorkstream);
	abort.resolve();

	const result = await operation;
	assert.equal(result.context?.workstreamId, secondWorkstream.id);
	assert.deepEqual(
		harness.calls
			.filter(({ kind }) => kind === 'abort-operation')
			.map(({ workstreamId }) => workstreamId),
		[firstWorkstream.id],
	);
	assert.deepEqual(
		harness.calls.filter(({ kind }) => kind === 'refresh'),
		[],
	);
	assertStatesBelongTo(statesAfterSwitch(), secondWorkstream.id);
});

test('does not publish a local mutation rejection into the next workstream', async () => {
	const abort = deferred<void>();
	const harness = createHarness({ abortOperation: () => abort.promise });
	const operation = harness.controller.abortOperation();

	await waitForCall(harness.calls, 'abort-operation');
	const statesAfterSwitch = harness.switchWorkstream(secondWorkstream);
	abort.reject(new Error('old abort failed'));

	const result = await operation;
	assert.equal(result.context?.workstreamId, secondWorkstream.id);
	assert.equal(result.localError, null);
	assert.equal(result.error, null);
	assert.equal(
		statesAfterSwitch().every((state) => state.localError === null && state.error === null),
		true,
	);
	assertStatesBelongTo(statesAfterSwitch(), secondWorkstream.id);
});

test('does not attach a pull request fetched for the old branch after same-workstream branch drift', async () => {
	const harness = createHarness({
		status: () =>
			Promise.resolve(
				repositoryStatus({
					branch: 'feature/new-branch',
					baseBranch: 'main',
				}),
			),
		pullRequest: () => Promise.resolve(pullRequest({ headBranch: firstWorkstream.branch })),
	});

	const state = await harness.controller.refresh();

	assert.equal(state.context?.branch, 'feature/new-branch');
	assert.equal(state.context?.pullRequest, null);
	assert.equal(state.pullRequestRefreshStatus, 'error');
	assert.match(state.pullRequestError ?? '', /branch changed during refresh/u);
});

test('never publishes a historical pull request from another branch', async () => {
	const harness = createHarness({
		pullRequest: () =>
			Promise.resolve(
				pullRequest({
					state: 'closed',
					number: 9,
					headBranch: 'feature/historical',
					title: 'Unrelated history',
				}),
			),
	});

	const state = await harness.controller.refreshPullRequest();

	assert.equal(state.context?.pullRequest, null);
	assert.equal(state.pullRequestRefreshStatus, 'error');
	assert.match(state.pullRequestError ?? '', /does not match the active repository branch/u);
});

test('keeps the newest pull request binding when same-workstream refreshes finish out of order', async () => {
	const firstPullRequest = deferred<ExtensionPullRequestContext>();
	const secondPullRequest = deferred<ExtensionPullRequestContext>();
	let pullRequestReads = 0;
	const harness = createHarness({
		withState: true,
		pullRequest: () => {
			pullRequestReads += 1;
			return pullRequestReads === 1 ? firstPullRequest.promise : secondPullRequest.promise;
		},
	});

	const firstRefresh = harness.controller.refreshPullRequest();
	await waitForCallCount(harness.calls, 'pull-request', 1);
	const secondRefresh = harness.controller.refreshPullRequest();
	await waitForCallCount(harness.calls, 'pull-request', 2);

	secondPullRequest.resolve(pullRequest({ number: 42, title: 'Newer pull request' }));
	const newer = await secondRefresh;
	assert.equal(newer.context?.pullRequest?.number, 42);

	firstPullRequest.resolve(pullRequest({ number: 41, title: 'Older pull request' }));
	const settled = await firstRefresh;
	assert.equal(settled.context?.pullRequest?.number, 42);
	assert.deepEqual(
		await harness.api.state!.get('pull-request-binding.v1', {
			kind: 'workstream',
			id: firstWorkstream.id,
		}),
		{
			version: 1,
			repositoryPath: firstWorkstream.repositoryPath,
			repositoryFullName: firstWorkstream.repositoryFullName ?? null,
			headBranch: firstWorkstream.branch,
			baseBranch: firstWorkstream.baseBranch,
			pullRequestNumber: 42,
		},
	);
});

test('terminal PR bindings are preserved while clean and retired when new work appears', async (t) => {
	const binding = (pullRequestNumber: number) => ({
		version: 1 as const,
		repositoryPath: firstWorkstream.repositoryPath,
		repositoryFullName: firstWorkstream.repositoryFullName ?? null,
		headBranch: firstWorkstream.branch,
		baseBranch: firstWorkstream.baseBranch,
		pullRequestNumber,
	});

	await t.test('preserves the exact terminal PR while the worktree stays clean', async () => {
		const harness = createHarness({
			withState: true,
			status: () => Promise.resolve(repositoryStatus({ headSha: 'merged-head' })),
			pullRequest: (_workstreamId, query) =>
				Promise.resolve(
					pullRequest({
						state: 'merged',
						number: query?.pullRequestNumber ?? 41,
						title: 'Merged review',
						headSha: 'merged-head',
					}),
				),
		});
		await harness.api.state!.set('pull-request-binding.v1', binding(41), {
			kind: 'workstream',
			id: firstWorkstream.id,
		});

		const terminal = await harness.controller.refreshPullRequest();
		assert.equal(terminal.context?.pullRequest?.state, 'merged');
		const state = await harness.controller.refreshLocal();

		assert.equal(state.context?.pullRequest?.state, 'merged');
		assert.equal(state.context?.pullRequest?.number, 41);
		assert.deepEqual(
			harness.calls.filter(({ kind }) => kind === 'pull-request').map(({ query }) => query ?? null),
			[{ pullRequestNumber: 41 }],
		);
	});

	await t.test('keeps a terminal PR whose head already holds an older local HEAD', async () => {
		const harness = createHarness({
			withState: true,
			status: () => Promise.resolve(repositoryStatus({ headSha: 'older-local-head' })),
			pullRequest: (_workstreamId, query) =>
				Promise.resolve(
					pullRequest({
						state: 'merged',
						number: query?.pullRequestNumber ?? 41,
						title: 'Merged review',
						headSha: 'merged-head',
						includesLocalHead: true,
					}),
				),
		});
		await harness.api.state!.set('pull-request-binding.v1', binding(41), {
			kind: 'workstream',
			id: firstWorkstream.id,
		});

		await harness.controller.refreshPullRequest();
		const state = await harness.controller.refreshLocal();

		assert.equal(state.context?.pullRequest?.state, 'merged');
		assert.equal(state.context?.pullRequest?.number, 41);
		assert.deepEqual(
			harness.calls.filter(({ kind }) => kind === 'pull-request').map(({ query }) => query ?? null),
			[{ pullRequestNumber: 41 }],
		);
	});

	await t.test('discovers a replacement open PR after new local work', async () => {
		const harness = createHarness({
			withState: true,
			status: () => Promise.resolve(repositoryStatus({ ahead: 1 })),
			pullRequest: (_workstreamId, query) =>
				Promise.resolve(
					query?.pullRequestNumber === 41
						? pullRequest({ state: 'merged', number: 41, title: 'Merged review' })
						: pullRequest({ state: 'open', number: 42, title: 'Replacement review' }),
				),
		});
		await harness.api.state!.set('pull-request-binding.v1', binding(41), {
			kind: 'workstream',
			id: firstWorkstream.id,
		});

		const terminal = await harness.controller.refreshPullRequest();
		assert.equal(terminal.context?.pullRequest?.state, 'merged');
		const state = await harness.controller.refreshLocal();

		assert.equal(state.context?.pullRequest?.state, 'open');
		assert.equal(state.context?.pullRequest?.number, 42);
		assert.deepEqual(
			harness.calls.filter(({ kind }) => kind === 'pull-request').map(({ query }) => query ?? null),
			[{ pullRequestNumber: 41 }, null],
		);
		assert.deepEqual(
			await harness.api.state!.get('pull-request-binding.v1', {
				kind: 'workstream',
				id: firstWorkstream.id,
			}),
			binding(42),
		);
	});

	await t.test('retires a terminal binding for a clean, fully pushed new HEAD', async () => {
		const harness = createHarness({
			withState: true,
			status: () => Promise.resolve(repositoryStatus({ headSha: 'new-pushed-head' })),
			pullRequest: (_workstreamId, query) =>
				Promise.resolve(
					query?.pullRequestNumber === 41
						? pullRequest({
								state: 'merged',
								number: 41,
								title: 'Merged review',
								headSha: 'merged-head',
							})
						: pullRequest({
								state: 'not_open',
								number: null,
								title: null,
								url: null,
								headSha: null,
							}),
				),
		});
		await harness.api.state!.set('pull-request-binding.v1', binding(41), {
			kind: 'workstream',
			id: firstWorkstream.id,
		});

		await harness.controller.refreshPullRequest();
		const state = await harness.controller.refreshLocal();

		assert.equal(state.context?.pullRequest?.state, 'not_open');
		assert.deepEqual(
			harness.calls.filter(({ kind }) => kind === 'pull-request').map(({ query }) => query ?? null),
			[{ pullRequestNumber: 41 }, null],
		);
		assert.equal(
			await harness.api.state!.get('pull-request-binding.v1', {
				kind: 'workstream',
				id: firstWorkstream.id,
			}),
			null,
		);
	});
});

test('abort merge asks the host to abort and reads the worktree again', async () => {
	const harness = createHarness();

	await harness.controller.abortOperation();

	const kinds = harness.calls.map(({ kind }) => kind);
	assert.equal(kinds.filter((kind) => kind === 'abort-operation').length, 1);
	assert.ok(kinds.lastIndexOf('status') > kinds.indexOf('abort-operation'));
});

test('serializes repository mutations within one workstream', async () => {
	const abort = deferred<void>();
	const harness = createHarness({ abortOperation: () => abort.promise });
	const first = harness.controller.abortOperation();
	await waitForCall(harness.calls, 'abort-operation');

	await assert.rejects(
		harness.controller.abortOperation(),
		/another repository action is already in progress/iu,
	);
	abort.resolve();
	await first;
});

type Call = Readonly<{
	kind: string;
	workstreamId?: string | undefined;
	query?: ExtensionPullRequestQuery | undefined;
}>;

type HarnessOptions = Readonly<{
	listFiles?: (workstreamId: string) => Promise<readonly string[]>;
	status?: (workstreamId: string) => Promise<ExtensionRepositoryStatus>;
	diff?: (workstreamId: string, path?: string) => Promise<readonly ExtensionRepositoryDiff[]>;
	pullRequest?: (
		workstreamId: string,
		query?: ExtensionPullRequestQuery,
	) => Promise<ExtensionPullRequestContext>;
	abortOperation?: (workstreamId: string) => Promise<void>;
	refresh?: (workstreamId: string) => Promise<void>;
	withState?: boolean;
}>;

function createHarness(options: HarnessOptions = {}) {
	let activeWorkstream = firstWorkstream;
	const calls: Call[] = [];
	const persistedState = new Map<string, unknown>();
	const api = {
		workstream: {
			current: () => activeWorkstream,
			listFiles: async (_glob?: string, workstreamId?: string) => {
				calls.push({ kind: 'list-files', workstreamId });
				return options.listFiles?.(requiredWorkstreamId(workstreamId)) ?? [];
			},
			readFile: async (_path: string, workstreamId?: string) => {
				calls.push({ kind: 'read-file', workstreamId });
				return '';
			},
		},
		repository: {
			status: async (workstreamId?: string) => {
				calls.push({ kind: 'status', workstreamId });
				return options.status?.(requiredWorkstreamId(workstreamId)) ?? repositoryStatus();
			},
			diff: async (path?: string, workstreamId?: string) => {
				calls.push({ kind: 'diff', workstreamId });
				return options.diff?.(requiredWorkstreamId(workstreamId), path) ?? [];
			},
			pullRequest: async (workstreamId?: string, query?: ExtensionPullRequestQuery) => {
				calls.push({ kind: 'pull-request', workstreamId, query });
				return (
					options.pullRequest?.(requiredWorkstreamId(workstreamId), query) ??
					pullRequest({ state: 'not_open', number: null, url: null })
				);
			},
			refresh: async (workstreamId?: string) => {
				calls.push({ kind: 'refresh', workstreamId });
				await options.refresh?.(requiredWorkstreamId(workstreamId));
			},
			abortOperation: async (workstreamId?: string) => {
				calls.push({ kind: 'abort-operation', workstreamId });
				await options.abortOperation?.(requiredWorkstreamId(workstreamId));
			},
		},
		settings: { get: () => false },
		clock: { now: () => 1 },
		state: {
			get: async (key: string, _scope?: ExtensionSettingScope) => persistedState.get(key) ?? null,
			set: async (key: string, value: unknown, _scope?: ExtensionSettingScope) => {
				persistedState.set(key, value);
			},
			delete: async (key: string, _scope?: ExtensionSettingScope) => {
				persistedState.delete(key);
			},
		},
	};
	const controller = new RepositoryController(api);
	const states: RepositoryViewState[] = [];
	controller.subscribe((state) => states.push(state));

	return {
		api,
		calls,
		controller,
		switchWorkstream(next: ExtensionWorkstream) {
			activeWorkstream = next;
			controller.setWorkstream(next);
			const start = states.length - 1;
			return () => states.slice(start);
		},
	};
}

function workstream(id: string, branch: string): ExtensionWorkstream {
	return {
		id,
		path: `/tmp/${id}`,
		repositoryPath: `/tmp/${id}`,
		repositoryFullName: `acme/${id}`,
		branch,
		baseBranch: 'main',
	};
}

function repositoryStatus(
	overrides: Partial<ExtensionRepositoryStatus> = {},
): ExtensionRepositoryStatus {
	return {
		branch: firstWorkstream.branch,
		baseBranch: firstWorkstream.baseBranch,
		dirtyPaths: [],
		ahead: 0,
		behind: 0,
		...overrides,
	};
}

function pullRequest(
	overrides: Partial<ExtensionPullRequestContext> = {},
): ExtensionPullRequestContext {
	return {
		state: 'open',
		number: 42,
		title: 'Ship safely',
		url: 'https://example.test/pull/42',
		baseBranch: 'main',
		headBranch: firstWorkstream.branch,
		headSha: 'head-42',
		mergeable: true,
		mergeableState: 'clean',
		checks: 'success',
		viewerCanMerge: true,
		allowedMergeMethods: ['squash'],
		defaultMergeMethod: null,
		unresolvedReviewThreadCount: 0,
		...overrides,
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((next, fail) => {
		resolve = next;
		reject = fail;
	});
	return { promise, resolve, reject };
}

async function waitForCall(calls: readonly Call[], kind: string): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (calls.some((call) => call.kind === kind)) return;
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	assert.fail(`Timed out waiting for ${kind}`);
}

async function waitForCallCount(
	calls: readonly Call[],
	kind: string,
	count: number,
): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (calls.filter((call) => call.kind === kind).length >= count) return;
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	assert.fail(`Timed out waiting for ${count} ${kind} calls`);
}

function requiredWorkstreamId(workstreamId: string | undefined): string {
	assert.ok(workstreamId, 'repository operations must carry their initiating workstream ID');
	return workstreamId;
}

function assertStatesBelongTo(states: readonly RepositoryViewState[], workstreamId: string): void {
	assert.ok(states.length > 0);
	assert.equal(
		states.every((state) => state.context?.workstreamId === workstreamId),
		true,
	);
}
