import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestHost } from '../src/test-host.js';
import type { ExtensionModule } from '../src/types.js';

const manifest = {
	schemaVersion: 1,
	id: 'example.test-host',
	name: 'Test Host',
	version: '1.0.0',
	apiVersion: 1,
	description: 'Deterministic host contract',
	publisher: 'example',
	entrypoint: './dist/index.js',
	activationEvents: ['onStartup'],
	contributes: {
		commands: [{ id: 'example.echo', title: 'Echo' }],
		settings: [{ id: 'example.enabled', label: 'Enabled', type: 'boolean', default: true }],
	},
} as const;

test('captures deterministic lifecycle, side effects, cleanup, and replay', async () => {
	const extension: ExtensionModule = {
		activate: (api) => {
			api.settings.register(manifest.contributes.settings[0]);
			api.commands.register({
				...manifest.contributes.commands[0],
				handler: (value) => `echo:${String(value)}`,
			});
		},
	};

	const host = await createTestHost({
		manifest,
		fixtureRepository: { name: 'repo', files: { 'README.md': 'hello' } },
	});
	await host.activate(extension);
	assert.equal(await host.invokeCommand('example.echo', 'ok'), 'echo:ok');
	assert.deepEqual(await host.api.workstream.listFiles(), ['README.md']);
	await host.deactivate();
	host.assertClean();
	const recording = host.recording();
	await host.cleanup();

	const replay = await createTestHost({
		manifest,
		replay: recording,
		fixtureRepository: { name: 'repo', files: { 'README.md': 'hello' } },
	});
	await replay.activate(extension);
	assert.equal(await replay.invokeCommand('example.echo', 'ok'), 'echo:ok');
	await replay.api.workstream.listFiles();
	await replay.deactivate();
	replay.assertReplayComplete();
	replay.assertClean();
	await replay.cleanup();
});

test('rejects runtime contributions missing from the manifest', async () => {
	const host = await createTestHost({ manifest });
	await assert.rejects(
		host.activate({
			activate: (api) => {
				api.commands.register({ id: 'private.escape', title: 'Escape', handler: () => undefined });
			},
		}),
		/not declared in manifest/u,
	);
	await host.cleanup();
});

test('provides deterministic repository context', async () => {
	const host = await createTestHost({
		manifest,
		repository: {
			status: { dirtyPaths: ['src/index.ts'], ahead: 2 },
			diffs: [
				{ path: 'src/index.ts', patch: '+export const ready = true;', additions: 1, deletions: 0 },
			],
			pullRequest: {
				state: 'open',
				number: 42,
				title: 'Ship it',
				url: 'https://example.test/pr/42',
				checkItems: [
					{
						name: 'Unit tests',
						appId: 15_368,
						state: 'completed',
						conclusion: 'success',
						required: true,
						url: 'https://example.test/check/42',
						startedAt: '2026-07-22T08:00:00Z',
						completedAt: '2026-07-22T08:01:00Z',
					},
				],
			},
		},
	});
	try {
		await host.activate({ activate: () => undefined });
		assert.deepEqual(await host.api.repository.status(), {
			branch: 'feature/test',
			baseBranch: 'main',
			dirtyPaths: ['src/index.ts'],
			conflictedPaths: [],
			conflictMarkerPaths: [],
			ahead: 2,
			behind: 0,
			hasUpstream: true,
			mergeInProgress: false,
			operationInProgress: null,
		});
		assert.equal((await host.api.repository.diff())[0]?.additions, 1);
		const pullRequest = await host.api.repository.pullRequest();
		assert.equal(pullRequest.number, 42);
		assert.equal(pullRequest.checkItems?.[0]?.appId, 15_368);
		assert.equal(await host.api.repository.pullLatest(), 'main');
		assert.deepEqual(
			host.recording().find(({ kind }) => kind === 'repository.pullLatest')?.payload,
			{ baseBranch: 'main' },
		);
		await host.deactivate();
		host.assertClean();
	} finally {
		await host.cleanup();
	}
});

test('models opt-in pull request readiness and merge mutations', async () => {
	const host = await createTestHost({
		manifest,
		repository: {
			supportsPullRequestMutations: true,
			pullRequest: {
				state: 'draft',
				number: 42,
				title: 'Ship it',
				url: 'https://example.test/pr/42',
				headSha: 'head-42',
				checks: 'success',
			},
		},
	});
	try {
		assert.ok(host.api.repository.markPullRequestReadyForReview);
		assert.ok(host.api.repository.mergePullRequest);
		assert.equal(
			(await host.api.repository.markPullRequestReadyForReview({ number: 42 })).state,
			'open',
		);
		assert.equal(
			(
				await host.api.repository.mergePullRequest({
					number: 42,
					expectedHeadSha: 'head-42',
					mergeMethod: 'squash',
				})
			).state,
			'merged',
		);
		assert.equal(
			(await host.api.repository.pullRequest(undefined, { pullRequestNumber: 42 })).state,
			'merged',
		);
		assert.deepEqual(
			host
				.recording()
				.filter(
					({ kind }) =>
						kind.startsWith('repository.mark') || kind === 'repository.mergePullRequest',
				)
				.map(({ kind }) => kind),
			['repository.markPullRequestReadyForReview', 'repository.mergePullRequest'],
		);
	} finally {
		await host.cleanup();
	}
});

test('models exact-head on-demand pull request diagnostics without adding them to status', async () => {
	const headSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
	const host = await createTestHost({
		manifest,
		repository: {
			pullRequest: {
				state: 'open',
				number: 42,
				title: 'Fix checks',
				url: 'https://example.test/pr/42',
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
				commitStatuses: null,
				commitStatusesComplete: false,
				truncated: false,
			},
		},
	});
	try {
		assert.ok(host.api.repository.pullRequestReviewFeedback);
		assert.ok(host.api.repository.pullRequestCheckDiagnostics);
		assert.deepEqual(
			await host.api.repository.pullRequestReviewFeedback({ number: 42, expectedHeadSha: headSha }),
			{
				unresolvedThreads: [],
				unresolvedThreadsComplete: true,
				requestedChangeReviews: [],
				requestedChangeReviewsComplete: true,
				truncated: false,
			},
		);
		assert.deepEqual(
			await host.api.repository.pullRequestCheckDiagnostics({
				number: 42,
				expectedHeadSha: headSha,
			}),
			{
				checkRuns: [],
				checkRunsComplete: true,
				commitStatuses: null,
				commitStatusesComplete: false,
				truncated: false,
			},
		);
		await assert.rejects(
			host.api.repository.pullRequestCheckDiagnostics({
				number: 42,
				expectedHeadSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
			}),
			/Pull request head changed/u,
		);
		assert.equal('reviewFeedback' in (await host.api.repository.pullRequest()), false);
		assert.deepEqual(
			host
				.recording()
				.filter(({ kind }) => kind.includes('pullRequest') && kind.includes('Diagnostics'))
				.map(({ kind }) => kind),
			['repository.pullRequestCheckDiagnostics'],
		);
	} finally {
		await host.cleanup();
	}
});

test('models scoped settings and their change notifications', async () => {
	const host = await createTestHost({ manifest });
	const changes: unknown[] = [];
	try {
		await host.activate({
			activate: (api) => {
				api.settings.register(manifest.contributes.settings[0]);
				api.settings.onDidChange((change) => {
					changes.push(change);
				});
			},
		});
		await host.api.settings.set('example.enabled', false, {
			kind: 'workstream',
			id: 'workstream-1',
		});
		assert.equal(
			host.api.settings.get('example.enabled', { kind: 'workstream', id: 'workstream-1' }),
			false,
		);
		assert.equal(changes.length, 1);

		await host.deactivate();
		host.assertClean();
	} finally {
		await host.cleanup();
	}
});

test('models workstream switching', async () => {
	const host = await createTestHost({ manifest });
	try {
		await host.activate({ activate: () => undefined });
		await host.setWorkstream({ id: 'workstream-2', branch: 'feature/second' });
		assert.equal(host.workstream.id, 'workstream-2');
		assert.equal((await host.api.repository.status('workstream-2')).branch, 'feature/second');
		await assert.rejects(host.api.repository.status('workstream-1'), /Unknown fixture workstream/u);

		await host.deactivate();
		host.assertClean();
	} finally {
		await host.cleanup();
	}
});

test('records typed workstream navigation without exposing host routing details', async () => {
	const host = await createTestHost({ manifest });
	try {
		const navigation = host.api.navigation;
		assert.ok(navigation);
		assert.equal(navigation.ensureWorkstream, undefined);
		assert.deepEqual(await navigation.listWorkstreams(), [
			{
				id: 'workstream-1',
				name: 'fixture',
				branch: 'feature/test',
				repositoryFullName: 'fixture',
			},
		]);
		await navigation.openWorkstream({
			workstreamId: 'workstream-linear-42',
			source: { provider: 'linear', resourceId: 'issue-42' },
		});
		assert.deepEqual(host.recording().at(-1), {
			sequence: 2,
			at: 1_700_000_000_000,
			kind: 'navigation.openWorkstream',
			payload: {
				workstreamId: 'workstream-linear-42',
				source: { provider: 'linear', resourceId: 'issue-42' },
			},
		});
		await assert.rejects(
			navigation.openWorkstream({ workstreamId: ' ' }),
			/Workstream id cannot be empty/u,
		);
	} finally {
		await host.cleanup();
	}
});

test('records host-owned workstream creation without exposing native workstream paths', async () => {
	const host = await createTestHost({
		manifest,
		ensureWorkstream: async ({ name }) => ({
			id: 'workstream-linear-43',
			name,
			branch: 'malini/workstream-linear-43',
		}),
	});
	try {
		const navigation = host.api.navigation;
		assert.ok(navigation?.ensureWorkstream);
		const created = await navigation.ensureWorkstream({
			name: 'SMK-43 · Surface readiness failures',
			task: 'Implement SMK-43 from the Linear description.',
			source: {
				provider: 'linear',
				resourceId: 'issue-43',
				title: 'SMK-43 · Surface readiness failures',
				url: 'https://linear.app/acme/issue/SMK-43',
			},
		});
		assert.deepEqual(created, {
			id: 'workstream-linear-43',
			name: 'SMK-43 · Surface readiness failures',
			branch: 'malini/workstream-linear-43',
		});
		assert.deepEqual(
			host.recording().find(({ kind }) => kind === 'navigation.ensureWorkstream')?.payload,
			{
				name: 'SMK-43 · Surface readiness failures',
				task: 'Implement SMK-43 from the Linear description.',
				source: {
					provider: 'linear',
					resourceId: 'issue-43',
					title: 'SMK-43 · Surface readiness failures',
					url: 'https://linear.app/acme/issue/SMK-43',
				},
			},
		);
	} finally {
		await host.cleanup();
	}
});
