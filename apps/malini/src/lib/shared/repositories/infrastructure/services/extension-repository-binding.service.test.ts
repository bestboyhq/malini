import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runtimeDiagnostics } from '$shared/performance/runtime-diagnostics.svelte';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import type { PullRequestStatusDto } from '$contract/repositories';
import type { Workstream } from '$shared/repositories/domain/workstream';
import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import {
	ExtensionRepositoryBindingService,
	extensionRepositoryBindingService as binding,
} from './extension-repository-binding.service';

let platform: FakePlatform;
let repoId: string;

beforeEach(async () => {
	runtimeDiagnostics.reset();
	platform = createFakePlatform({ projects: [], workstreams: [] });
	setPlatformForTest(platform);
	const repo = await platform.invoke('repositories.connect', {
		source: { kind: 'clone-url', url: 'https://github.com/rabbits/hutch.git' },
	});
	repoId = repo.id;
	await repositoriesAggregate.refresh();
	await workstreamsAggregate.refresh();
	workstreamsAggregate.upsert(workstream());
	platform.calls.length = 0;
});

afterEach(() => {
	setPlatformForTest(null);
	repositoriesAggregate.reset();
	workstreamsAggregate.reset();
});

function workstream(overrides: Partial<Workstream> = {}): Workstream {
	return {
		id: 'workstream-1',
		projectId: 'local__rabbits__hutch',
		name: 'Bright Thread',
		path: '/tmp/malini/workstream-1',
		branch: 'malini/workstream-1',
		baseBranch: 'main',
		status: 'active',
		checkoutState: 'healthy',
		checkoutIssue: null,
		resolvedPath: null,
		...overrides,
	};
}

function argsOf(command: string): unknown[] {
	return platform.calls.filter((call) => call.command === command).map(({ args }) => args);
}

function pullRequestStatus(overrides: Partial<PullRequestStatusDto> = {}): PullRequestStatusDto {
	return {
		state: 'open',
		number: 42,
		url: 'https://github.com/rabbits/hutch/pull/42',
		title: 'Ship it',
		draft: true,
		headRef: 'malini/workstream-1',
		baseRef: 'main',
		headSha: 'head-42',
		includesLocalHead: null,
		mergeable: true,
		mergeableState: 'clean',
		behindBase: null,
		checksState: 'success',
		checks: [],
		viewerCanMerge: true,
		allowedMergeMethods: ['squash'],
		defaultMergeMethod: null,
		reviewDecision: 'approved',
		unresolvedReviewThreadCount: 0,
		updatedAt: '2026-07-06T08:00:00Z',
		...overrides,
	};
}

describe('the extension repository binding', () => {
	it('binds a push to the resolved repository identity without a token', async () => {
		await expect(binding.pushRepository('workstream-1')).resolves.toBe('malini/workstream-1');
		expect(argsOf('repositories.push-workstream')).toEqual([
			{ workstreamId: 'workstream-1', expectedRepositoryFullName: 'rabbits/hutch' },
		]);
	});

	it('pulls the target branch through the checkout alone', async () => {
		await expect(binding.pullRepository('workstream-1', 'main')).resolves.toBe('main');
		expect(argsOf('repositories.pull-workstream')).toEqual([
			{ workstreamId: 'workstream-1', baseBranch: 'main' },
		]);
		expect(runtimeDiagnostics.recent.at(-1)).toMatchObject({
			category: 'repository',
			label: 'Pulling base branch',
			target: 'workstream-1',
			budgetMs: 4_000,
			outcome: 'ok',
		});
	});

	it('creates a pull request against the workstream branches with a malini default body', async () => {
		await expect(
			binding.createPullRequest('workstream-1', { title: 'Ship it' }),
		).resolves.toMatchObject({
			state: 'open',
			title: 'Ship it',
			baseBranch: 'main',
			headBranch: 'malini/workstream-1',
		});
		expect(argsOf('pull-requests.create')).toEqual([
			{
				workstreamId: 'workstream-1',
				repoId,
				head: 'malini/workstream-1',
				base: 'main',
				title: 'Ship it',
				body: 'Created from malini for rabbits/hutch.',
				draft: false,
			},
		]);
	});

	it('marks drafts ready and merges with the extension-provided expected head SHA', async () => {
		await binding.createPullRequest('workstream-1', { title: 'Ship it', draft: true });

		await expect(
			binding.markPullRequestReadyForReview('workstream-1', { number: 100 }),
		).resolves.toMatchObject({ state: 'open', number: 100, headSha: 'fake-head-sha' });
		await expect(
			binding.mergePullRequest('workstream-1', {
				number: 100,
				expectedHeadSha: 'fake-head-sha',
				mergeMethod: 'squash',
			}),
		).resolves.toMatchObject({ state: 'merged', number: 100, headSha: 'fake-head-sha' });

		expect(argsOf('pull-requests.mark-ready')).toEqual([
			{ workstreamId: 'workstream-1', repoId, pullRequestNumber: 100 },
		]);
		expect(argsOf('pull-requests.merge')).toEqual([
			{
				workstreamId: 'workstream-1',
				repoId,
				pullRequestNumber: 100,
				mergeMethod: 'squash',
				expectedHeadSha: 'fake-head-sha',
			},
		]);
	});

	it('binds on-demand diagnostics to the repository and pull request', async () => {
		await binding.createPullRequest('workstream-1', { title: 'Ship it' });
		const request = { number: 100, expectedHeadSha: 'fake-head-sha' };

		await expect(binding.pullRequestReviewFeedback('workstream-1', request)).resolves.toEqual({
			unresolvedThreads: [],
			unresolvedThreadsComplete: true,
			requestedChangeReviews: [],
			requestedChangeReviewsComplete: true,
			truncated: false,
		});
		await expect(binding.pullRequestCheckDiagnostics('workstream-1', request)).resolves.toEqual({
			checkRuns: [],
			checkRunsComplete: true,
			commitStatuses: [],
			commitStatusesComplete: true,
			truncated: false,
		});
		expect(argsOf('pull-requests.review-feedback')).toEqual([
			{ workstreamId: 'workstream-1', repoId, pullRequestNumber: 100 },
		]);
		expect(argsOf('pull-requests.check-diagnostics')).toEqual([
			{ workstreamId: 'workstream-1', repoId, pullRequestNumber: 100 },
		]);
		expect(runtimeDiagnostics.recent.slice(-2)).toMatchObject([
			{ label: 'Reading pull request review feedback', target: 'workstream-1', outcome: 'ok' },
			{ label: 'Reading pull request check diagnostics', target: 'workstream-1', outcome: 'ok' },
		]);
	});

	it('presents an open draft as a draft and keeps the explicit no-checks state', async () => {
		platform.define('pull-requests.status', () =>
			pullRequestStatus({ draft: false, checksState: 'none' }),
		);

		await expect(
			binding.pullRequest('workstream-1', { pullRequestNumber: 42 }),
		).resolves.toMatchObject({
			state: 'open',
			mergeable: true,
			mergeableState: 'clean',
			checks: 'none',
			viewerCanMerge: true,
			allowedMergeMethods: ['squash'],
		});
		expect(argsOf('pull-requests.status')).toEqual([
			{
				workstreamId: 'workstream-1',
				repoId,
				head: 'malini/workstream-1',
				base: 'main',
				pullRequestNumber: 42,
			},
		]);

		platform.define('pull-requests.status', () => pullRequestStatus());
		await expect(binding.pullRequest('workstream-1')).resolves.toMatchObject({ state: 'draft' });
	});

	it('preserves the GitHub App identity of detailed checks and why GitHub never started one', async () => {
		platform.define('pull-requests.status', () =>
			pullRequestStatus({
				draft: false,
				checks: [
					{
						name: 'Unit tests',
						appId: 15_368,
						state: 'completed',
						conclusion: 'success',
						required: true,
						url: 'https://example.test/check/42',
						startedAt: '2026-07-22T08:00:00Z',
						completedAt: '2026-07-22T08:01:00Z',
						notStartedReason: null,
					},
					{
						name: 'e2e',
						appId: 15_368,
						state: 'COMPLETED',
						conclusion: 'FAILURE',
						required: null,
						url: 'https://example.test/check/43',
						startedAt: '2026-07-22T08:00:00Z',
						completedAt: '2026-07-22T08:00:03Z',
						notStartedReason: 'your spending limit needs to be increased',
					},
				],
			}),
		);

		await expect(binding.pullRequest('workstream-1')).resolves.toMatchObject({
			checkItems: [
				{ name: 'Unit tests', appId: 15_368, notStartedReason: null },
				{ name: 'e2e', notStartedReason: 'your spending limit needs to be increased' },
			],
		});
	});

	it('reports the pull request as unavailable when gh is signed out', async () => {
		const signedOut = (): never => {
			throw new Error('GitHub CLI is not signed in. Run `gh auth login` in a terminal.');
		};
		platform.define('pull-requests.status', signedOut);
		platform.define('pull-requests.create', signedOut);

		await expect(binding.pullRequest('workstream-1')).resolves.toMatchObject({
			state: 'unavailable',
			headBranch: 'malini/workstream-1',
			checks: 'unknown',
		});
		expect(argsOf('pull-requests.status')).toHaveLength(1);
		await expect(binding.createPullRequest('workstream-1', { title: 'Ship it' })).rejects.toThrow(
			'gh auth login',
		);
	});

	it('refreshes local worktree state when no remote repository is connected', async () => {
		repositoriesAggregate.reset();
		platform.seed({
			projects: [
				{
					id: 'local-project',
					name: 'local-project',
					repoPath: '/tmp/local-project',
					defaultBranch: 'main',
				},
			],
			workstreams: [],
		});
		await workstreamsAggregate.refresh();
		workstreamsAggregate.upsert(workstream({ projectId: 'local-project' }));

		await expect(binding.refreshRepository('workstream-1')).resolves.toBeUndefined();
		await expect(binding.pullRequest('workstream-1')).resolves.toEqual({
			state: 'unavailable',
			number: null,
			title: null,
			url: null,
			baseBranch: 'main',
			headBranch: 'malini/workstream-1',
			headSha: null,
			mergeable: null,
			mergeableState: null,
			checks: 'unknown',
		});

		expect(argsOf('repositories.workstream-status')).toEqual([{ workstreamId: 'workstream-1' }]);
		expect(argsOf('pull-requests.status')).toEqual([]);
	});

	it('refreshes connected worktree state without prefetching pull request state', async () => {
		await expect(binding.refreshRepository('workstream-1')).resolves.toBeUndefined();

		expect(platform.calls).toEqual([
			{ command: 'repositories.workstream-status', args: { workstreamId: 'workstream-1' } },
		]);
	});

	it('does not expose a repository context while the workstreams are still loading', async () => {
		workstreamsAggregate.reset();

		await expect(binding.refreshRepository('workstream-1')).rejects.toThrow(
			'Extension repository context is still loading',
		);
		expect(platform.calls).toEqual([]);
		expect(runtimeDiagnostics.active).toEqual([]);
		expect(runtimeDiagnostics.recent.at(-1)).toMatchObject({
			category: 'repository',
			label: 'Reading repository worktree status',
			target: 'workstream-1',
			outcome: 'error',
		});
	});

	it('refuses pull request writes for a repository GitHub cannot host', async () => {
		repositoriesAggregate.reset();
		platform.seed({
			projects: [
				{ id: 'local-project', name: 'local-project', repoPath: '/tmp/lp', defaultBranch: 'main' },
			],
			workstreams: [],
		});
		await workstreamsAggregate.refresh();
		workstreamsAggregate.upsert(workstream({ projectId: 'local-project' }));

		await expect(binding.createPullRequest('workstream-1', { title: 'Ship it' })).rejects.toThrow(
			'Pull requests are unavailable for this repository',
		);
		expect(argsOf('pull-requests.create')).toEqual([]);
	});
});

describe('pull request reads through the extension repository binding', () => {
	let now = 1_000;
	let shared: ExtensionRepositoryBindingService;

	beforeEach(() => {
		now = 1_000;
		shared = new ExtensionRepositoryBindingService(() => now);
		platform.define('pull-requests.status', (input) =>
			pullRequestStatus({ number: 42, headRef: input.head, baseRef: input.base ?? 'main' }),
		);
	});

	it('answers a read that accepts a recent answer from the last read of the same pull request', async () => {
		await shared.pullRequest('workstream-1');
		now += 60_000;

		await expect(
			shared.pullRequest('workstream-1', { maxAgeMs: 5 * 60_000 }),
		).resolves.toMatchObject({ state: 'draft', number: 42 });
		expect(argsOf('pull-requests.status')).toHaveLength(1);

		now += 5 * 60_000;
		await shared.pullRequest('workstream-1', { maxAgeMs: 5 * 60_000 });
		expect(argsOf('pull-requests.status')).toHaveLength(2);
	});

	it('asks GitHub again for a read that does not accept an earlier answer', async () => {
		await shared.pullRequest('workstream-1', { maxAgeMs: 5 * 60_000 });

		await shared.pullRequest('workstream-1');

		expect(argsOf('pull-requests.status')).toHaveLength(2);
	});

	it('shares one GitHub read between identical reads already in flight', async () => {
		const answer = heldPullRequestReads();

		const reads = [
			shared.pullRequest('workstream-1', { maxAgeMs: 5 * 60_000 }),
			shared.pullRequest('workstream-1'),
			shared.pullRequest('workstream-1', { maxAgeMs: 5 * 60_000 }),
		];
		answer();

		await expect(Promise.all(reads)).resolves.toHaveLength(3);
		expect(argsOf('pull-requests.status')).toHaveLength(1);
	});

	it('answers a read of a bound pull request from the latest one on the branch when they are the same', async () => {
		await shared.pullRequest('workstream-1', { maxAgeMs: 5 * 60_000 });

		await shared.pullRequest('workstream-1', { pullRequestNumber: 42, maxAgeMs: 5 * 60_000 });
		expect(argsOf('pull-requests.status')).toHaveLength(1);

		await shared.pullRequest('workstream-1', { pullRequestNumber: 7, maxAgeMs: 5 * 60_000 });
		expect(argsOf('pull-requests.status')).toEqual([
			{ workstreamId: 'workstream-1', repoId, head: 'malini/workstream-1', base: 'main' },
			{
				workstreamId: 'workstream-1',
				repoId,
				head: 'malini/workstream-1',
				base: 'main',
				pullRequestNumber: 7,
			},
		]);
	});

	it('shares a read made while the connected repositories were still loading', async () => {
		await platform.invoke('repositories.create-repository', {
			repoUrl: 'https://github.com/rabbits/hutch.git',
		});
		await workstreamsAggregate.refresh();
		workstreamsAggregate.upsert(workstream());
		repositoriesAggregate.reset();
		await shared.pullRequest('workstream-1', { maxAgeMs: 5 * 60_000 });

		await repositoriesAggregate.refresh();
		await shared.pullRequest('workstream-1', { maxAgeMs: 5 * 60_000 });
		await shared.pullRequest('workstream-1');

		expect(
			argsOf('pull-requests.status').map((args) =>
				typeof args === 'object' && args !== null && 'repoId' in args ? args.repoId : null,
			),
		).toEqual(['local:local__rabbits__hutch', repoId]);
	});

	it('never reuses a failed read', async () => {
		platform.define('pull-requests.status', () => {
			throw new Error('gh timed out');
		});
		await expect(shared.pullRequest('workstream-1', { maxAgeMs: 5 * 60_000 })).rejects.toThrow(
			'gh timed out',
		);

		await expect(shared.pullRequest('workstream-1', { maxAgeMs: 5 * 60_000 })).rejects.toThrow(
			'gh timed out',
		);
		expect(argsOf('pull-requests.status')).toHaveLength(2);
	});

	it.each([
		['pushing the branch', (): Promise<unknown> => shared.pushRepository('workstream-1')],
		[
			'pulling the base branch',
			(): Promise<unknown> => shared.pullRepository('workstream-1', 'main'),
		],
		[
			'opening a pull request',
			(): Promise<unknown> => shared.createPullRequest('workstream-1', { title: 'Ship it' }),
		],
		[
			'marking the pull request ready',
			(): Promise<unknown> => shared.markPullRequestReadyForReview('workstream-1', { number: 100 }),
		],
		[
			'merging the pull request',
			(): Promise<unknown> =>
				shared.mergePullRequest('workstream-1', { number: 100, expectedHeadSha: 'fake-head-sha' }),
		],
	])('asks GitHub again after %s', async (_change, change) => {
		await binding.createPullRequest('workstream-1', { title: 'Seed', draft: true });
		await shared.pullRequest('workstream-1', { maxAgeMs: 5 * 60_000 });

		await change();
		await shared.pullRequest('workstream-1', { maxAgeMs: 5 * 60_000 });

		expect(argsOf('pull-requests.status')).toHaveLength(2);
	});

	it('does not keep an answer read while the branch was being pushed', async () => {
		const answer = heldPullRequestReads();
		const before = shared.pullRequest('workstream-1', { maxAgeMs: 5 * 60_000 });

		await shared.pushRepository('workstream-1');
		answer();
		await before;
		await shared.pullRequest('workstream-1', { maxAgeMs: 5 * 60_000 });

		expect(argsOf('pull-requests.status')).toHaveLength(2);
	});
	it('does not keep an answer read before the push finished', async () => {
		let finishPush!: () => void;
		const pushing = new Promise<void>((resolve) => {
			finishPush = resolve;
		});
		platform.define('repositories.push-workstream', async () => {
			await pushing;
			return 'malini/workstream-1';
		});
		const push = shared.pushRepository('workstream-1');

		await shared.pullRequest('workstream-1', { maxAgeMs: 5 * 60_000 });
		finishPush();
		await push;
		await shared.pullRequest('workstream-1', { maxAgeMs: 5 * 60_000 });

		expect(argsOf('pull-requests.status')).toHaveLength(2);
	});
});

function heldPullRequestReads(): () => void {
	let answer!: () => void;
	const held = new Promise<void>((resolve) => {
		answer = resolve;
	});
	platform.define('pull-requests.status', async (input) => {
		await held;
		return pullRequestStatus({ number: 42, headRef: input.head, baseRef: input.base ?? 'main' });
	});
	return answer;
}
