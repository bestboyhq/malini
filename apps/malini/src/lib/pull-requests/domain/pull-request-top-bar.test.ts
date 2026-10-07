import { describe, expect, it } from 'vitest';
import type { RepositorySurfaceState } from '@malini-extension/repository';

import { RepositorySurfaceMapper } from '$lib/pull-requests/infrastructure/mappers/repository-surface.mapper';
import type {
	PullRequestActionKind,
	PullRequestAvailability,
	PullRequestTopBarPresentation,
} from './pull-request-action';
import { pullRequestFixIsActionable, pullRequestTopBarPresentation } from './pull-request-top-bar';

function topBar(
	raw: RepositorySurfaceState | null,
	availability: PullRequestAvailability = 'ready',
): PullRequestTopBarPresentation | null {
	return pullRequestTopBarPresentation(
		raw === null ? null : RepositorySurfaceMapper.fromRaw(raw),
		availability,
	);
}

function fixIsActionable(raw: RepositorySurfaceState): boolean {
	return pullRequestFixIsActionable(RepositorySurfaceMapper.fromRaw(raw));
}

function state(overrides: Partial<RepositorySurfaceState> = {}): RepositorySurfaceState {
	return {
		status: 'ready',
		workstreamId: 'workstream-1',
		branch: 'feature/keyboard-navigation',
		baseBranch: 'main',
		dirtyPaths: [],
		conflictedPaths: [],
		conflictMarkerPaths: [],
		ahead: 0,
		behind: 0,
		hasUpstream: true,
		mergeInProgress: false,
		operationInProgress: null,
		changedFiles: 1,
		pullRequest: {
			state: 'not_open',
			number: null,
			title: null,
			url: null,
			baseBranch: 'main',
			headBranch: 'feature/keyboard-navigation',
			checks: 'unknown',
		},
		pullRequestRefreshStatus: 'ready',
		pullRequestRefreshedAt: 123,
		pullRequestSettledAt: 123,
		localError: null,
		pullRequestError: null,
		error: null,
		todoStatus: 'ready',
		todoOpenCount: 0,
		todoError: null,
		...overrides,
	};
}

const NEXT_ACTION_VOCABULARY: Readonly<Record<PullRequestActionKind, readonly string[]>> = {
	unavailable: ['Connect GitHub', 'Enable Repository'],
	reconnect: ['Reconnect GitHub'],
	retry: ['Retry status'],
	fix: ['Resolve conflicts', 'Fix errors'],
	push: ['Commit and push'],
	update: ['Update branch'],
	create: ['Create PR'],
	ready: ['Ready for review'],
	todos: ['Review todos'],
	merge: ['Merge'],
	merged: ['Archive'],
	open: ['Open PR', "CI didn't start"],
	checking: ['Checking…'],
	operation: ['Rebase in progress', 'Cherry-pick in progress', 'Revert in progress'],
	'agent-running': ['Agent working…'],
	'no-changes': ['No changes'],
};

function nextAction(
	scenario: RepositorySurfaceState | null,
	availability: PullRequestAvailability = 'ready',
): PullRequestTopBarPresentation {
	const presentation = topBar(scenario, availability);
	if (!presentation) throw new Error('The derivation offered no action for this state');
	expect(NEXT_ACTION_VOCABULARY[presentation.kind]).toContain(presentation.label);
	const otherLabels = Object.entries(NEXT_ACTION_VOCABULARY)
		.filter(([kind]) => kind !== presentation.kind)
		.flatMap(([, labels]) => labels);
	expect(otherLabels).not.toContain(presentation.label);
	return presentation;
}

function openPullRequestState(
	overrides: Partial<NonNullable<RepositorySurfaceState['pullRequest']>>,
	stateOverrides: Partial<RepositorySurfaceState> = {},
): RepositorySurfaceState {
	return state({
		...stateOverrides,
		pullRequest: {
			...state().pullRequest!,
			state: 'open',
			number: 27,
			url: 'https://example.test/pull/27',
			headSha: 'head-27',
			viewerCanMerge: true,
			allowedMergeMethods: ['squash'],
			defaultMergeMethod: null,
			unresolvedReviewThreadCount: 0,
			...overrides,
		},
	});
}

const mergeable = {
	checks: 'success' as const,
	mergeable: true,
	mergeableState: 'clean',
};

const EXPIRED_GITHUB_SESSION =
	'API request failed: POST /api/auth/github/refresh 502: {"message":"GitHub OAuth refresh failed: The client_id and/or client_secret passed are incorrect.","error":"Bad Gateway","statusCode":502}';

describe('the next action a workstream is asking for', () => {
	it.each([
		{
			branch: 'GitHub is not connected',
			scenario: null,
			availability: 'github-unavailable' as const,
			expected: { kind: 'unavailable', label: 'Connect GitHub', disabled: true },
		},
		{
			branch: 'the Repository extension is off',
			scenario: null,
			availability: 'extension-unavailable' as const,
			expected: { kind: 'unavailable', label: 'Enable Repository', disabled: true },
		},
		{
			branch: 'the repository has no GitHub account',
			scenario: state({ pullRequest: { ...state().pullRequest!, state: 'unavailable' } }),
			availability: 'ready' as const,
			expected: { kind: 'unavailable', label: 'Connect GitHub', disabled: true },
		},
		{
			branch: 'the local read failed',
			scenario: state({
				status: 'error',
				localError: 'git status failed',
				error: 'git status failed',
			}),
			availability: 'ready' as const,
			expected: { kind: 'retry', label: 'Retry status', disabled: false },
		},
		{
			branch: 'the workstream agent is still writing uncommitted changes',
			scenario: state({ dirtyPaths: ['src/index.ts'] }),
			availability: 'agent-running' as const,
			expected: { kind: 'agent-running', label: 'Agent working…', disabled: true },
		},
		{
			branch: 'the remote read failed over a cached green pull request',
			scenario: openPullRequestState(mergeable, {
				pullRequestRefreshStatus: 'error',
				pullRequestError: 'checks endpoint failed',
				error: 'checks endpoint failed',
			}),
			availability: 'ready' as const,
			expected: { kind: 'retry', label: 'Retry status', disabled: false },
		},
		{
			branch: 'the GitHub sign-in is spent',
			scenario: openPullRequestState(mergeable, {
				pullRequestRefreshStatus: 'error',
				pullRequestError: EXPIRED_GITHUB_SESSION,
				error: EXPIRED_GITHUB_SESSION,
			}),
			availability: 'ready' as const,
			expected: { kind: 'reconnect', label: 'Reconnect GitHub', disabled: false },
		},
		{
			branch: 'the branch conflicts with its base',
			scenario: openPullRequestState({
				checks: 'success',
				mergeable: false,
				mergeableState: 'dirty',
			}),
			availability: 'ready' as const,
			expected: { kind: 'fix', label: 'Resolve conflicts', disabled: false },
		},
		{
			branch: 'there are uncommitted files',
			scenario: state({ dirtyPaths: ['src/new.ts'], changedFiles: 1 }),
			availability: 'ready' as const,
			expected: { kind: 'push', label: 'Commit and push', disabled: false },
		},
		{
			branch: 'there are unpushed commits',
			scenario: openPullRequestState(mergeable, { ahead: 2 }),
			availability: 'ready' as const,
			expected: { kind: 'push', label: 'Commit and push', disabled: false },
		},
		{
			branch: 'the branch is behind its upstream',
			scenario: openPullRequestState(mergeable, { behind: 2 }),
			availability: 'ready' as const,
			expected: { kind: 'update', label: 'Update branch', disabled: false },
		},
		{
			branch: 'the pull request is behind its base',
			scenario: openPullRequestState({ ...mergeable, mergeableState: 'behind' }),
			availability: 'ready' as const,
			expected: { kind: 'update', label: 'Update branch', disabled: false },
		},
		{
			branch: 'no pull request exists',
			scenario: state(),
			availability: 'ready' as const,
			expected: { kind: 'create', label: 'Create PR', disabled: false },
		},
		{
			branch: 'the pull request merged and nothing new is left',
			scenario: state({
				pullRequest: { ...state().pullRequest!, state: 'merged', number: 11, url: 'u' },
			}),
			availability: 'ready' as const,
			expected: { kind: 'merged', label: 'Archive', disabled: false },
		},
		{
			branch: 'the previous pull request closed unmerged',
			scenario: state({
				pullRequest: { ...state().pullRequest!, state: 'closed', number: 11, url: 'u' },
			}),
			availability: 'ready' as const,
			expected: { kind: 'create', label: 'Create PR', disabled: false },
		},
		{
			branch: 'the pull request is a draft',
			scenario: state({
				pullRequest: { ...state().pullRequest!, state: 'draft', number: 9, url: 'u' },
			}),
			availability: 'ready' as const,
			expected: { kind: 'ready', label: 'Ready for review', disabled: false },
		},
		{
			branch: 'a reviewer asked for changes',
			scenario: openPullRequestState({ ...mergeable, reviewDecision: 'changes_requested' }),
			availability: 'ready' as const,
			expected: { kind: 'fix', label: 'Fix errors', disabled: false },
		},
		{
			branch: 'review threads are unresolved',
			scenario: openPullRequestState({ ...mergeable, unresolvedReviewThreadCount: 2 }),
			availability: 'ready' as const,
			expected: { kind: 'fix', label: 'Fix errors', disabled: false },
		},
		{
			branch: 'a required check failed',
			scenario: openPullRequestState({ ...mergeable, checks: 'failed' }),
			availability: 'ready' as const,
			expected: { kind: 'fix', label: 'Fix errors', disabled: false },
		},
		{
			branch: 'a human approval is outstanding',
			scenario: openPullRequestState({ ...mergeable, reviewDecision: 'review_required' }),
			availability: 'ready' as const,
			expected: { kind: 'open', label: 'Open PR', disabled: false },
		},
		{
			branch: 'checks are still running',
			scenario: openPullRequestState({ ...mergeable, checks: 'pending' }),
			availability: 'ready' as const,
			expected: { kind: 'open', label: 'Open PR', disabled: false },
		},
		{
			branch: 'GitHub has not picked up the latest push yet',
			scenario: openPullRequestState({
				...mergeable,
				includesLocalHead: false,
				checks: 'pending',
				mergeable: null,
				mergeableState: 'UNKNOWN',
			}),
			availability: 'ready' as const,
			expected: { kind: 'checking', label: 'Checking…', disabled: true },
		},
		{
			branch: 'GitHub has not yet worked out whether the pushed head merges',
			scenario: openPullRequestState({ ...mergeable, mergeable: null, mergeableState: 'UNKNOWN' }),
			availability: 'ready' as const,
			expected: { kind: 'checking', label: 'Checking…', disabled: true },
		},
		{
			branch: 'this account cannot merge',
			scenario: openPullRequestState({ ...mergeable, viewerCanMerge: false }),
			availability: 'ready' as const,
			expected: { kind: 'open', label: 'Open PR', disabled: false },
		},
		{
			branch: 'workstream todos are still open',
			scenario: openPullRequestState(mergeable, { todoOpenCount: 2 }),
			availability: 'ready' as const,
			expected: { kind: 'todos', label: 'Review todos', disabled: false },
		},
		{
			branch: 'workstream todos are unreadable',
			scenario: openPullRequestState(mergeable, {
				todoStatus: 'error',
				todoError: 'Stored workstream todos are unreadable',
			}),
			availability: 'ready' as const,
			expected: { kind: 'todos', label: 'Review todos', disabled: false },
		},
		{
			branch: 'everything is green and permitted',
			scenario: openPullRequestState(mergeable),
			availability: 'ready' as const,
			expected: { kind: 'merge', label: 'Merge', disabled: false },
		},
	])('offers exactly one action when $branch', ({ scenario, availability, expected }) => {
		expect(nextAction(scenario, availability)).toMatchObject(expected);
	});

	it.each([
		{ branch: 'no surface has been published for this workstream', scenario: null },
		{ branch: 'the surface has never been read', scenario: state({ status: 'idle' }) },
		{
			branch: 'the first read of the workstream is still in flight',
			scenario: state({
				status: 'loading',
				pullRequestRefreshStatus: 'loading',
				pullRequestRefreshedAt: null,
			}),
		},
	])('offers no action at all when $branch', ({ scenario }) => {
		expect(topBar(scenario, 'ready')).toBeNull();
	});

	it.each([
		{ branch: 'the check aggregate is unavailable', pullRequest: { checks: 'unknown' as const } },
		{
			branch: 'the review thread read failed',
			pullRequest: { ...mergeable, unresolvedReviewThreadCount: null },
		},
		{ branch: 'merge permission is unknown', pullRequest: { ...mergeable, viewerCanMerge: null } },
		{ branch: 'the head revision is unknown', pullRequest: { ...mergeable, headSha: null } },
		{
			branch: 'GitHub is still computing mergeability',
			pullRequest: { ...mergeable, mergeableState: 'future_readyish_state' },
		},
	])('asks for one more read when $branch', ({ pullRequest }) => {
		expect(nextAction(openPullRequestState(pullRequest))).toMatchObject({
			kind: 'retry',
			label: 'Retry status',
			disabled: false,
		});
	});

	it('names the commit before the pull request when the previous one closed unmerged', () => {
		const pullRequest = { ...state().pullRequest!, state: 'closed' as const, number: 11, url: 'u' };
		expect(
			nextAction(state({ dirtyPaths: ['src/new-work.ts'], changedFiles: 1, pullRequest })),
		).toMatchObject({ kind: 'push', label: 'Commit and push' });
		expect(nextAction(state({ pullRequest }))).toMatchObject({
			kind: 'create',
			label: 'Create PR',
		});
	});

	it.each([
		{ work: 'uncommitted edits', overrides: { dirtyPaths: ['src/new-work.ts'], changedFiles: 1 } },
		{ work: 'a commit made after the merge', overrides: { ahead: 1, changedFiles: 1 } },
	])('keeps a merged pull request merged through $work', ({ overrides }) => {
		const pullRequest = { ...state().pullRequest!, state: 'merged' as const, number: 11, url: 'u' };
		expect(nextAction(state({ ...overrides, pullRequest }))).toMatchObject({
			kind: 'merged',
			label: 'Archive',
			tooltip: expect.stringContaining('saved ref'),
		});
	});

	it('keeps optional check failures out of the blocking verdict', () => {
		const optionalFailure = {
			name: 'Preview deploy',
			appId: 15_368,
			state: 'completed',
			conclusion: 'failure',
			required: false,
			url: 'https://example.test/check/preview',
			startedAt: '2026-07-22T08:00:00Z',
			completedAt: '2026-07-22T08:01:00Z',
		} as const;
		expect(
			nextAction(
				openPullRequestState({ ...mergeable, checks: 'failed', checkItems: [optionalFailure] }),
			),
		).toMatchObject({ kind: 'merge', label: 'Merge' });

		const requiredFailure = { ...optionalFailure, name: 'Unit tests', required: true } as const;
		expect(
			nextAction(
				openPullRequestState({ ...mergeable, checks: 'failed', checkItems: [requiredFailure] }),
			),
		).toMatchObject({ kind: 'fix', label: 'Fix errors' });

		const queued = {
			...requiredFailure,
			state: 'queued',
			conclusion: null,
			completedAt: null,
		} as const;
		expect(
			nextAction(openPullRequestState({ ...mergeable, checks: 'pending', checkItems: [queued] })),
		).toMatchObject({ kind: 'open', label: 'Open PR' });
	});

	it("says CI didn't start, never Fix errors, for checks GitHub never started", () => {
		const notStarted = {
			name: 'check, lint, test',
			appId: 15_368,
			state: 'COMPLETED',
			conclusion: 'FAILURE',
			required: null,
			url: 'https://github.com/bestboyhq/malini/actions/runs/37071097246/job/111050466288',
			startedAt: '2026-10-02T22:11:06Z',
			completedAt: '2026-10-02T22:11:09Z',
			notStartedReason:
				'recent account payments have failed or your spending limit needs to be increased',
		} as const;
		const onlyNotStarted = openPullRequestState({
			...mergeable,
			mergeableState: 'blocked',
			checks: 'failed',
			checkItems: [notStarted, { ...notStarted, name: 'app launches on macOS' }],
		});

		expect(nextAction(onlyNotStarted)).toEqual({
			kind: 'open',
			label: "CI didn't start",
			busyLabel: 'Opening PR…',
			ariaLabel: "CI didn't start. Open pull request on GitHub #27",
			tooltip:
				"GitHub didn't start CI: recent account payments have failed or your spending limit needs to be increased. Open the pull request on GitHub",
			disabled: false,
			tone: 'secondary',
			remoteFailure: null,
		});
		expect(fixIsActionable(onlyNotStarted)).toBe(false);

		const realFailure = {
			...notStarted,
			name: 'Unit tests',
			url: 'https://github.com/bestboyhq/malini/actions/runs/1/job/2',
			notStartedReason: null,
		} as const;
		expect(
			nextAction(
				openPullRequestState({
					...mergeable,
					checks: 'failed',
					checkItems: [notStarted, realFailure],
				}),
			),
		).toMatchObject({
			kind: 'fix',
			label: 'Fix errors',
			tooltip: '1 blocking check failed; inspect the failures in this workstream',
		});
		expect(
			nextAction(
				openPullRequestState({
					...mergeable,
					checks: 'failed',
					checkItems: [notStarted],
					unresolvedReviewThreadCount: 2,
				}),
			),
		).toMatchObject({ kind: 'fix', tooltip: 'Resolve 2 review threads in this workstream' });
	});

	it('lets a passing required check through to merge', () => {
		const passing = {
			name: 'Unit tests',
			appId: 15_368,
			state: 'completed',
			conclusion: 'success',
			required: true,
			url: null,
			startedAt: null,
			completedAt: null,
		} as const;
		expect(
			nextAction(openPullRequestState({ ...mergeable, checks: 'success', checkItems: [passing] })),
		).toMatchObject({ kind: 'merge', label: 'Merge' });
	});

	it('fails closed on an unknown aggregate even when partial rows passed', () => {
		expect(
			nextAction(
				openPullRequestState({
					...mergeable,
					checks: 'unknown',
					checkItems: [
						{
							name: 'Unit tests',
							appId: 15_368,
							state: 'completed',
							conclusion: 'success',
							required: true,
							url: null,
							startedAt: null,
							completedAt: null,
						},
					],
				}),
			),
		).toMatchObject({ kind: 'retry', label: 'Retry status' });
	});

	it('names the verb in progress rather than a second vocabulary', () => {
		for (const scenario of [
			state(),
			state({ dirtyPaths: ['a.ts'] }),
			openPullRequestState(mergeable, { behind: 1 }),
			openPullRequestState({ ...mergeable, mergeableState: 'dirty', mergeable: false }),
			openPullRequestState({ ...mergeable, checks: 'failed' }),
			openPullRequestState(mergeable),
		]) {
			const presentation = nextAction(scenario);
			expect(presentation.busyLabel).toMatch(/…$/u);
			expect(presentation.busyLabel).not.toBe(presentation.label);
		}
	});

	it('keeps the cached verb while a refresh is in flight', () => {
		expect(nextAction(state({ pullRequestRefreshStatus: 'loading' }))).toMatchObject({
			kind: 'create',
			label: 'Create PR',
			disabled: false,
		});
		expect(
			nextAction(
				openPullRequestState(
					{ checks: 'pending' },
					{ dirtyPaths: ['src/app.ts'], pullRequestRefreshStatus: 'loading' },
				),
			),
		).toMatchObject({ kind: 'push', label: 'Commit and push', disabled: false });
	});

	it.each([
		{ read: 'local', overrides: { status: 'loading' as const } },
		{ read: 'remote', overrides: { pullRequestRefreshStatus: 'loading' as const } },
		{
			read: 'combined',
			overrides: { status: 'loading' as const, pullRequestRefreshStatus: 'loading' as const },
		},
	])('says nothing about the $read read it is running', ({ overrides }) => {
		for (const scenario of [
			state(),
			state({ dirtyPaths: ['src/app.ts'], changedFiles: 1 }),
			state({ mergeInProgress: true, operationInProgress: 'merge' }),
			openPullRequestState(mergeable, { behind: 2 }),
			openPullRequestState({ ...mergeable, checks: 'pending' }),
			openPullRequestState({ ...mergeable, checks: 'failed' }),
			openPullRequestState(mergeable),
		]) {
			expect(nextAction({ ...scenario, ...overrides })).toEqual(nextAction(scenario));
		}
	});

	it('stays reachable through a refresh it did not ask for', () => {
		const merge = nextAction(openPullRequestState(mergeable, { status: 'loading' }));
		expect(merge).toMatchObject({ kind: 'merge', label: 'Merge', disabled: false });
		for (const scenario of [
			state(),
			state({ dirtyPaths: ['src/app.ts'], changedFiles: 1 }),
			openPullRequestState(mergeable, { behind: 2 }),
			openPullRequestState({ ...mergeable, checks: 'failed' }),
		]) {
			expect(nextAction({ ...scenario, pullRequestRefreshStatus: 'loading' }).disabled).toBe(false);
		}
	});

	it('only keeps the agent fix actionable when refreshed state still has a blocker', () => {
		expect(
			fixIsActionable(state({ status: 'error', localError: 'git failed', error: 'git failed' })),
		).toBe(false);
		expect(fixIsActionable(openPullRequestState({ ...mergeable, checks: 'failed' }))).toBe(true);
		expect(fixIsActionable(openPullRequestState({ checks: 'unknown' }))).toBe(false);
		expect(
			fixIsActionable(
				openPullRequestState({ checks: 'success', mergeable: false, mergeableState: 'dirty' }),
			),
		).toBe(true);
		expect(fixIsActionable(openPullRequestState(mergeable))).toBe(false);
		expect(fixIsActionable(openPullRequestState({ ...mergeable, checks: 'pending' }))).toBe(false);
	});

	it('names the repository merge method it will use', () => {
		expect(
			nextAction(openPullRequestState({ ...mergeable, allowedMergeMethods: ['rebase'] })).tooltip,
		).toContain('Rebase and merge');
		expect(
			nextAction(openPullRequestState({ ...mergeable, allowedMergeMethods: [] })),
		).toMatchObject({ kind: 'open', label: 'Open PR' });
	});

	it('disables Open PR when the pull request has no URL', () => {
		expect(
			nextAction(openPullRequestState({ ...mergeable, checks: 'pending', url: null })),
		).toMatchObject({ kind: 'open', label: 'Open PR', disabled: true });
	});
});

describe('a workstream with nothing to ship', () => {
	const closedPullRequest = { ...state().pullRequest!, state: 'closed' as const, number: 11 };

	it.each([
		{ branch: 'the branch sits exactly at its base', scenario: state({ changedFiles: 0 }) },
		{
			branch: 'the base moved on since the branch was cut',
			scenario: state({ changedFiles: 0, behind: 3 }),
		},
		{
			branch: 'the branch was reset to its base after a merged pull request',
			scenario: state({ changedFiles: 0, ahead: 4, behind: 2 }),
		},
		{
			branch: 'the previous pull request closed unmerged',
			scenario: state({ changedFiles: 0, pullRequest: { ...closedPullRequest, url: 'u' } }),
		},
		{
			branch: 'the branch tracks no remote',
			scenario: state({ changedFiles: 0, hasUpstream: false }),
		},
	])('offers no publishing verb when $branch', ({ scenario }) => {
		const presentation = nextAction(scenario);
		expect(presentation).toMatchObject({ kind: 'no-changes', disabled: true });
		expect(presentation.ariaLabel).not.toMatch(/pull request$|push/iu);
		expect(presentation.tooltip).toContain('nothing to open a pull request for yet');
	});

	it.each([
		{
			change: 'a file changes',
			scenario: state({ changedFiles: 1, dirtyPaths: ['src/new.ts'] }),
			expected: { kind: 'push', label: 'Commit and push', disabled: false },
		},
		{
			change: 'a commit lands ahead of the base',
			scenario: state({ changedFiles: 1, ahead: 1 }),
			expected: { kind: 'push', label: 'Commit and push', disabled: false },
		},
		{
			change: 'the commits are already pushed',
			scenario: state({ changedFiles: 1 }),
			expected: { kind: 'create', label: 'Create PR', disabled: false },
		},
	])('brings the publishing verb back once $change', ({ scenario, expected }) => {
		expect(nextAction(scenario)).toMatchObject(expected);
	});

	it('still shows a merged pull request as merged', () => {
		expect(
			nextAction(
				state({
					changedFiles: 0,
					pullRequest: { ...state().pullRequest!, state: 'merged', number: 11, url: 'u' },
				}),
			),
		).toMatchObject({ kind: 'merged', label: 'Archive' });
	});

	it('leaves an open pull request to its own verbs', () => {
		expect(nextAction(openPullRequestState(mergeable, { changedFiles: 0 }))).toMatchObject({
			kind: 'merge',
		});
		expect(
			nextAction(openPullRequestState(mergeable, { changedFiles: 0, ahead: 2 })),
		).toMatchObject({ kind: 'push', label: 'Commit and push' });
	});
});

describe('a GitHub sign-in that is finished', () => {
	it.each([
		{ wording: 'the live axios line', error: EXPIRED_GITHUB_SESSION },
		{
			wording: "GitHub's own body on its own",
			error: 'The client_id and/or client_secret passed are incorrect.',
		},
		{
			wording: 'an OAuth refresh failure',
			error: 'GitHub OAuth refresh failed',
		},
		{
			wording: 'the verdict the desktop already reached',
			error:
				'GitHub authorization expired. Continue with GitHub again to refresh repository access.',
		},
		{ wording: 'a revoked access token', error: 'Unauthorized: Bad credentials' },
		{ wording: 'a terminal OAuth grant failure', error: 'refresh failed: bad_refresh_token' },
	])('asks to reconnect when the surface reports $wording', ({ error }) => {
		expect(
			nextAction(openPullRequestState(mergeable, { pullRequestError: error, error })),
		).toMatchObject({ kind: 'reconnect', label: 'Reconnect GitHub', disabled: false });
	});

	it.each([
		{ failure: 'a failed checks endpoint', error: 'checks endpoint failed' },
		{ failure: 'a local git read', error: 'git status failed' },
		{
			failure: 'a backend that is simply down',
			error:
				'API request failed: POST /api/auth/github/refresh 502: {"message":"upstream unavailable","statusCode":502}',
		},
		{ failure: 'a timeout', error: 'Request timed out after 30000ms' },
	])('still asks for one more read after $failure', ({ error }) => {
		expect(
			nextAction(
				openPullRequestState(mergeable, {
					pullRequestRefreshStatus: 'error',
					pullRequestError: error,
					error,
				}),
			),
		).toMatchObject({ kind: 'retry', label: 'Retry status', disabled: false });
	});

	it('outranks the work verbs, and only while the session is finished', () => {
		const conflicted = {
			dirtyPaths: ['src/shared.ts'],
			conflictedPaths: ['src/shared.ts'],
			conflictMarkerPaths: ['src/shared.ts'],
			mergeInProgress: true,
			operationInProgress: 'merge' as const,
			changedFiles: 1,
		};
		expect(nextAction(openPullRequestState(mergeable, conflicted))).toMatchObject({
			kind: 'fix',
			label: 'Resolve conflicts',
		});
		expect(
			nextAction(
				openPullRequestState(mergeable, {
					...conflicted,
					pullRequestError: EXPIRED_GITHUB_SESSION,
					error: EXPIRED_GITHUB_SESSION,
				}),
			),
		).toMatchObject({ kind: 'reconnect', label: 'Reconnect GitHub' });

		expect(
			nextAction(openPullRequestState(mergeable, { dirtyPaths: ['src/new.ts'], changedFiles: 1 })),
		).toMatchObject({ kind: 'push', label: 'Commit and push' });
		expect(
			nextAction(
				openPullRequestState(mergeable, {
					dirtyPaths: ['src/new.ts'],
					changedFiles: 1,
					error: EXPIRED_GITHUB_SESSION,
				}),
			),
		).toMatchObject({ kind: 'reconnect', label: 'Reconnect GitHub' });

		expect(nextAction(openPullRequestState(mergeable))).toMatchObject({ kind: 'merge' });
		expect(nextAction(openPullRequestState({ ...mergeable, checks: 'failed' }))).toMatchObject({
			kind: 'fix',
			label: 'Fix errors',
		});
	});

	it('draws the way out as the action it is', () => {
		const reconnect = nextAction(
			openPullRequestState(mergeable, { error: EXPIRED_GITHUB_SESSION }),
		);
		expect(reconnect).toMatchObject({
			tone: 'primary',
			disabled: false,
			busyLabel: 'Reconnecting GitHub…',
		});
		expect(reconnect.ariaLabel).toContain('Reconnect');
		expect(reconnect.tooltip).toContain('Sign in with GitHub again');
	});

	it('says nothing about the read it is running', () => {
		const scenario = openPullRequestState(mergeable, { error: EXPIRED_GITHUB_SESSION });
		expect(nextAction({ ...scenario, pullRequestRefreshStatus: 'loading' })).toEqual(
			nextAction(scenario),
		);
	});

	it('never reads as an agent fix', () => {
		expect(
			fixIsActionable(
				openPullRequestState(mergeable, {
					dirtyPaths: ['src/shared.ts'],
					conflictedPaths: ['src/shared.ts'],
					conflictMarkerPaths: ['src/shared.ts'],
					changedFiles: 1,
					error: EXPIRED_GITHUB_SESSION,
				}),
			),
		).toBe(false);
	});
});

describe('a merge the worktree holds', () => {
	const marked = {
		mergeInProgress: true,
		operationInProgress: 'merge' as const,
		dirtyPaths: ['src/shared.ts'],
		conflictedPaths: ['src/shared.ts'],
		conflictMarkerPaths: ['src/shared.ts'],
		changedFiles: 1,
	};
	const resolved = { ...marked, conflictMarkerPaths: [] };
	const conflictingPullRequest = { ...mergeable, mergeable: false, mergeableState: 'dirty' };

	it.each([
		{ branch: 'no pull request exists', scenario: state(marked) },
		{
			branch: 'the previous pull request merged',
			scenario: state({
				...marked,
				pullRequest: { ...state().pullRequest!, state: 'merged', number: 11, url: 'u' },
			}),
		},
		{
			branch: 'GitHub still reports the conflict',
			scenario: openPullRequestState(conflictingPullRequest, marked),
		},
		{
			branch: 'the branch is also behind its base',
			scenario: openPullRequestState(
				{ ...mergeable, mergeableState: 'behind' },
				{ ...marked, behind: 3 },
			),
		},
		{
			branch: 'a green, mergeable pull request sits on it',
			scenario: openPullRequestState(mergeable, marked),
		},
	])('asks to resolve conflicts while files hold markers and $branch', ({ scenario }) => {
		expect(nextAction(scenario)).toMatchObject({
			kind: 'fix',
			label: 'Resolve conflicts',
			disabled: false,
		});
	});

	it.each([
		{ branch: 'GitHub still reports the conflict', pullRequest: conflictingPullRequest },
		{ branch: 'the pull request is green', pullRequest: mergeable },
	])('offers Commit and push once no markers remain and $branch', ({ pullRequest }) => {
		expect(nextAction(openPullRequestState(pullRequest, resolved))).toMatchObject({
			kind: 'push',
			label: 'Commit and push',
			tooltip: 'Commit the resolved merge and push it',
		});
	});

	it('takes a binary conflict as resolved by the content in place', () => {
		expect(
			nextAction(
				openPullRequestState(conflictingPullRequest, {
					mergeInProgress: true,
					operationInProgress: 'merge' as const,
					dirtyPaths: ['assets/logo.png'],
					conflictedPaths: ['assets/logo.png'],
					conflictMarkerPaths: [],
				}),
			),
		).toMatchObject({ kind: 'push', label: 'Commit and push' });
	});

	it('asks to merge and resolve when GitHub reports a conflict the worktree does not hold', () => {
		expect(nextAction(openPullRequestState(conflictingPullRequest))).toMatchObject({
			kind: 'fix',
			label: 'Resolve conflicts',
			tooltip:
				'This branch conflicts with main. Merge it into this workstream and have the agent resolve the conflicts',
		});
	});

	it('leaves the conflict state once the pushed merge reads clean', () => {
		expect(nextAction(openPullRequestState(mergeable))).toMatchObject({ kind: 'merge' });
	});

	it('outranks Commit and push on a dirty, conflicted, unpushed branch', () => {
		expect(
			nextAction(
				openPullRequestState(mergeable, {
					dirtyPaths: ['src/shared.ts', 'src/other.ts'],
					conflictedPaths: ['src/shared.ts'],
					conflictMarkerPaths: ['src/shared.ts'],
					changedFiles: 2,
					ahead: 4,
				}),
			),
		).toMatchObject({ kind: 'fix', label: 'Resolve conflicts' });
	});

	it('ignores a stale mergeable_state on a closed pull request', () => {
		expect(
			nextAction(
				state({
					pullRequest: {
						...state().pullRequest!,
						state: 'closed',
						number: 11,
						url: 'u',
						mergeableState: 'dirty',
					},
				}),
			),
		).toMatchObject({ kind: 'create', label: 'Create PR' });
	});

	it.each([
		{ operation: 'rebase' as const, label: 'Rebase in progress' },
		{ operation: 'cherry-pick' as const, label: 'Cherry-pick in progress' },
		{ operation: 'revert' as const, label: 'Revert in progress' },
	])(
		'shows a $operation as in progress, never as Commit and push or Resolve conflicts',
		({ operation, label }) => {
			for (const conflictMarkerPaths of [['src/shared.ts'], []]) {
				expect(
					nextAction(
						openPullRequestState(conflictingPullRequest, {
							...marked,
							operationInProgress: operation,
							conflictMarkerPaths,
						}),
					),
				).toMatchObject({ kind: 'operation', label, disabled: true });
			}
		},
	);

	it('counts the files that still hold conflict markers', () => {
		const held = (paths: readonly string[]): RepositorySurfaceState =>
			state({
				mergeInProgress: true,
				operationInProgress: 'merge' as const,
				dirtyPaths: [...paths, 'assets/logo.png'],
				conflictedPaths: [...paths, 'assets/logo.png'],
				conflictMarkerPaths: [...paths],
			});
		expect(nextAction(held(['a.ts'])).tooltip).toBe(
			'1 file still has conflict markers. Have the agent resolve them, or abort the merge from the pull request menu',
		);
		expect(nextAction(held(['a.ts', 'b.ts'])).tooltip).toContain(
			'2 files still have conflict markers',
		);
	});
});

describe('a branch that tracks no remote', () => {
	it('offers Commit and push rather than Merge under a published pull request', () => {
		expect(nextAction(openPullRequestState(mergeable, { hasUpstream: false }))).toMatchObject({
			kind: 'push',
			label: 'Commit and push',
			disabled: false,
		});
		expect(nextAction(openPullRequestState(mergeable))).toMatchObject({ kind: 'merge' });
	});

	it('counts no commits it cannot count', () => {
		expect(nextAction(openPullRequestState(mergeable, { hasUpstream: false })).tooltip).toBe(
			'Push this branch, which does not track a remote yet',
		);
		expect(nextAction(openPullRequestState(mergeable, { ahead: 2 })).tooltip).toContain(
			'Push 2 commits',
		);
	});

	it('still opens a pull request when there is none to push to', () => {
		expect(nextAction(state({ hasUpstream: false }))).toMatchObject({
			kind: 'create',
			label: 'Create PR',
		});
	});

	it('still names the uncommitted files it has', () => {
		expect(
			nextAction(
				openPullRequestState(mergeable, {
					hasUpstream: false,
					dirtyPaths: ['src/app.ts'],
					changedFiles: 1,
				}),
			).tooltip,
		).toContain('Commit and push 1 changed file');
	});
});

describe('a remote read that failed under a worktree that answered', () => {
	const remoteDown = {
		pullRequestRefreshStatus: 'error' as const,
		pullRequestError: 'checks endpoint failed',
		error: 'checks endpoint failed',
	};

	it('keeps Commit and push over uncommitted files', () => {
		expect(
			nextAction(state({ ...remoteDown, dirtyPaths: ['src/new.ts'], changedFiles: 1 })),
		).toMatchObject({ kind: 'push', label: 'Commit and push', disabled: false });
	});

	it('keeps Commit and push over unpushed commits', () => {
		expect(nextAction(openPullRequestState(mergeable, { ...remoteDown, ahead: 2 }))).toMatchObject({
			kind: 'push',
			label: 'Commit and push',
		});
	});

	it('keeps Resolve conflicts over a worktree holding conflict markers', () => {
		expect(
			nextAction(
				state({
					...remoteDown,
					conflictedPaths: ['src/app.ts'],
					conflictMarkerPaths: ['src/app.ts'],
					dirtyPaths: ['src/app.ts'],
				}),
			),
		).toMatchObject({ kind: 'fix', label: 'Resolve conflicts' });
	});

	it('reports the failure beside the verb rather than instead of it', () => {
		expect(nextAction(state({ ...remoteDown, dirtyPaths: ['src/new.ts'] })).remoteFailure).toBe(
			'checks endpoint failed',
		);
	});

	it('names a refresh that errored without a message of its own', () => {
		expect(
			nextAction(
				state({
					pullRequestRefreshStatus: 'error',
					dirtyPaths: ['src/new.ts'],
				}),
			).remoteFailure,
		).toBe('Pull request status is unavailable');
	});

	it('still falls back to Retry status when the worktree has nothing to say', () => {
		const presentation = nextAction(openPullRequestState(mergeable, remoteDown));
		expect(presentation).toMatchObject({ kind: 'retry', label: 'Retry status' });
		expect(presentation.remoteFailure).toBeNull();
	});

	it('does not offer a worktree verb when git itself could not be read', () => {
		expect(
			nextAction(
				state({
					status: 'error',
					localError: 'git status failed',
					error: 'git status failed',
					dirtyPaths: ['src/new.ts'],
				}),
			),
		).toMatchObject({ kind: 'retry', label: 'Retry status' });
	});
});

describe('a pull request with required checks still running', () => {
	const requiredPending = {
		name: 'CI',
		appId: 15_368,
		state: 'in_progress',
		conclusion: null,
		required: true,
		url: null,
		startedAt: null,
		completedAt: null,
	} as const;

	it('says "it" for one required check still running', () => {
		const tooltip = nextAction(
			openPullRequestState({
				...mergeable,
				checks: 'pending',
				checkItems: [requiredPending],
			}),
		).tooltip;
		expect(tooltip).toContain('1 required check still running');
		expect(tooltip).toContain('Watch it on GitHub');
		expect(tooltip).not.toContain('Watch them');
	});

	it('says "them" for multiple required checks still running', () => {
		const tooltip = nextAction(
			openPullRequestState({
				...mergeable,
				checks: 'pending',
				checkItems: [requiredPending, { ...requiredPending, name: 'Lint' }],
			}),
		).tooltip;
		expect(tooltip).toContain('2 required checks still running');
		expect(tooltip).toContain('Watch them on GitHub');
		expect(tooltip).not.toContain('Watch it');
	});
});

describe('the Merge tooltip', () => {
	const passed = {
		name: 'unit tests',
		appId: null,
		state: 'COMPLETED',
		conclusion: 'SUCCESS',
		required: true,
		url: null,
		startedAt: null,
		completedAt: null,
	} as const;

	it('says checks passed only for a pull request that has checks', () => {
		expect(nextAction(openPullRequestState({ ...mergeable, checkItems: [passed] })).tooltip).toBe(
			'Checks passed. Squash and merge',
		);
	});

	it('says no checks are configured for a pull request without any', () => {
		const merge = nextAction(openPullRequestState({ ...mergeable, checks: 'none' }));

		expect(merge).toMatchObject({ kind: 'merge', label: 'Merge' });
		expect(merge.tooltip).toBe('No checks configured. Squash and merge');
	});
});
