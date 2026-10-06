import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExtensionPullRequestCheck, ExtensionPullRequestContext } from '@malini/extension-api';
import type { RepositorySurfaceState } from '../src/controller.js';
import { pullRequestCheckDurationLabel, repositoryGithubStatus } from '../src/github-status.js';

function surface(overrides: Partial<RepositorySurfaceState> = {}): RepositorySurfaceState {
	return {
		status: 'ready',
		workstreamId: 'workstream-1',
		branch: 'feature/review',
		baseBranch: 'main',
		dirtyPaths: [],
		conflictedPaths: [],
		conflictMarkerPaths: [],
		ahead: 0,
		behind: 0,
		hasUpstream: true,
		mergeInProgress: false,
		operationInProgress: null,
		changedFiles: 0,
		pullRequest: null,
		pullRequestRefreshStatus: 'ready',
		pullRequestRefreshedAt: 1,
		pullRequestSettledAt: 1,
		localError: null,
		pullRequestError: null,
		error: null,
		todoStatus: 'ready',
		todoOpenCount: 0,
		todoError: null,
		...overrides,
	};
}

function openPullRequest(
	overrides: Partial<ExtensionPullRequestContext> = {},
): ExtensionPullRequestContext {
	return {
		state: 'open',
		number: 128,
		title: 'Move GitHub status to the top bar',
		url: 'https://example.test/pull/128',
		baseBranch: 'main',
		headBranch: 'feature/review',
		headSha: 'head-128',
		mergeable: true,
		mergeableState: 'clean',
		checks: 'success',
		viewerCanMerge: true,
		allowedMergeMethods: ['squash'],
		unresolvedReviewThreadCount: 0,
		...overrides,
	};
}

function check(overrides: Partial<ExtensionPullRequestCheck> = {}): ExtensionPullRequestCheck {
	return {
		name: 'Unit tests',
		appId: 15_368,
		state: 'completed',
		conclusion: 'success',
		required: true,
		url: 'https://example.test/check/1',
		startedAt: null,
		completedAt: null,
		...overrides,
	};
}

test('stays silent when there is nothing truthful to say about GitHub', () => {
	assert.equal(repositoryGithubStatus(null), null);
	assert.equal(repositoryGithubStatus(surface({ status: 'idle' })), null);
	assert.equal(repositoryGithubStatus(surface(), 'github-unavailable'), null);
	assert.equal(repositoryGithubStatus(surface(), 'extension-unavailable'), null);
	assert.equal(repositoryGithubStatus(surface(), 'checking'), null);
	assert.equal(
		repositoryGithubStatus(surface({ pullRequest: openPullRequest({ state: 'unavailable' }) })),
		null,
	);
});

test('collapses an open pull request to its identity and per-check detail', () => {
	const status = repositoryGithubStatus(
		surface({
			pullRequest: openPullRequest({
				checks: 'failed',
				checkItems: [
					check({ name: 'Lint', conclusion: 'failure' }),
					check({ name: 'Types', conclusion: 'success' }),
					check({ name: 'E2E', state: 'in_progress', conclusion: null }),
					check({ name: 'Optional audit', conclusion: 'failure', required: false }),
				],
			}),
		}),
	);

	assert.ok(status);
	assert.equal(status.reference, '#128');
	assert.equal(status.url, 'https://example.test/pull/128');
	assert.equal(status.branch, 'feature/review → main');
	assert.equal(status.checksSummary, '1 passed · 2 failing · 1 running');
	assert.deepEqual(
		status.checks.map((row) => [row.name, row.blocking]),
		[
			['Lint', true],
			['E2E', true],
			['Types', false],
			['Optional audit', false],
		],
	);
	assert.equal(status.checks[0]?.tone, 'danger');
	assert.equal(status.checks[1]?.tone, 'progress');
	assert.equal(status.checks[3]?.detail, 'Failed · optional');
});

test('names a check GitHub never started apart from a failure', () => {
	const status = repositoryGithubStatus(
		surface({
			pullRequest: openPullRequest({
				checks: 'failed',
				checkItems: [
					check({
						name: 'check, lint, test',
						state: 'COMPLETED',
						conclusion: 'FAILURE',
						startedAt: '2026-10-02T22:11:06Z',
						completedAt: '2026-10-02T22:11:09Z',
						notStartedReason: 'your spending limit needs to be increased',
					}),
					check({ name: 'Lint', conclusion: 'failure' }),
					check({ name: 'Types', conclusion: 'success' }),
				],
			}),
		}),
	);

	assert.ok(status);
	assert.equal(status.checksSummary, "1 passed · 1 failing · 1 didn't start");
	assert.deepEqual(
		status.checks.map((row) => [row.name, row.detail, row.blocking]),
		[
			['check, lint, test', "Didn't start", true],
			['Lint', 'Failed', true],
			['Types', 'Passed', false],
		],
	);
});

test('passes no verdict of its own', () => {
	const status = repositoryGithubStatus(surface({ pullRequest: openPullRequest() }));
	assert.ok(status);
	for (const field of ['summary', 'tone', 'blockingCount']) {
		assert.equal(
			field in status,
			false,
			`${field} is a second status vocabulary; the next action is the only verdict`,
		);
	}
});

test('describes unpublished work before a pull request exists', () => {
	assert.equal(repositoryGithubStatus(surface({ dirtyPaths: ['a.ts', 'b.ts'] }))?.reference, null);
	assert.equal(
		repositoryGithubStatus(surface({ dirtyPaths: ['src/app.ts', 'src/b.ts'] }))?.changes?.label,
		'2 uncommitted',
	);
	assert.deepEqual(repositoryGithubStatus(surface({ ahead: 3 }))?.changes, {
		label: '3 unpushed',
		tone: 'warning',
	});
	assert.equal(repositoryGithubStatus(surface())?.changes, null);
});

test('surfaces terminal pull request identity without inventing blockers', () => {
	for (const state of ['merged', 'closed', 'draft'] as const) {
		const status = repositoryGithubStatus(surface({ pullRequest: openPullRequest({ state }) }));
		assert.equal(status?.reference, '#128');
		assert.equal(status?.url, 'https://example.test/pull/128');
	}
	for (const state of ['merged', 'closed'] as const) {
		const status = repositoryGithubStatus(
			surface({ pullRequest: openPullRequest({ state, unresolvedReviewThreadCount: null }) }),
		);
		assert.equal(status?.review, null);
	}
});

test('keeps the last known detail while a refresh is in flight', () => {
	const status = repositoryGithubStatus(
		surface({ pullRequest: openPullRequest(), pullRequestRefreshStatus: 'loading' }),
	);
	assert.equal(status?.refreshing, true);
	assert.equal(status?.checksSummary, 'Checks passed');
});

test('projects review and todo blockers as their own popover notes', () => {
	assert.deepEqual(
		repositoryGithubStatus(
			surface({ pullRequest: openPullRequest({ unresolvedReviewThreadCount: 2 }) }),
		)?.review,
		{ label: '2 unresolved threads', tone: 'danger' },
	);
	assert.deepEqual(
		repositoryGithubStatus(
			surface({ pullRequest: openPullRequest({ reviewDecision: 'changes_requested' }) }),
		)?.review,
		{ label: 'Changes requested', tone: 'danger' },
	);
	assert.deepEqual(
		repositoryGithubStatus(
			surface({ pullRequest: openPullRequest({ reviewDecision: 'approved' }) }),
		)?.review,
		{ label: 'Approved', tone: 'success' },
	);
	assert.deepEqual(
		repositoryGithubStatus(
			surface({ pullRequest: openPullRequest({ unresolvedReviewThreadCount: null }) }),
		)?.review,
		{ label: 'Review status unavailable', tone: 'warning' },
	);
	assert.deepEqual(
		repositoryGithubStatus(surface({ pullRequest: openPullRequest(), todoOpenCount: 1 }))?.todos,
		{ label: '1 open todo', tone: 'warning' },
	);
	assert.deepEqual(
		repositoryGithubStatus(surface({ pullRequest: openPullRequest(), todoStatus: 'error' }))?.todos,
		{ label: 'Todos unavailable', tone: 'warning' },
	);
});

test('names every check result in words, keeping its duration', () => {
	const results: readonly (readonly [string, string | null, string])[] = [
		['COMPLETED', 'SUCCESS', 'Passed'],
		['COMPLETED', 'FAILURE', 'Failed'],
		['COMPLETED', 'CANCELLED', 'Cancelled'],
		['COMPLETED', 'TIMED_OUT', 'Timed out'],
		['COMPLETED', 'STARTUP_FAILURE', 'Startup failure'],
		['COMPLETED', 'ACTION_REQUIRED', 'Action required'],
		['COMPLETED', 'NEUTRAL', 'Neutral'],
		['COMPLETED', 'SKIPPED', 'Skipped'],
		['COMPLETED', 'STALE', 'Stale'],
		['COMPLETED', null, 'Completed'],
		['IN_PROGRESS', null, 'Running'],
		['QUEUED', null, 'Queued'],
		['PENDING', null, 'Pending'],
		['WAITING', null, 'Waiting'],
		['REQUESTED', null, 'Requested'],
		['EXPECTED', null, 'Expected'],
		['SUCCESS', null, 'Passed'],
		['FAILURE', null, 'Failed'],
		['ERROR', null, 'Error'],
		['UNKNOWN', null, 'Unknown'],
		['completed', 'success', 'Passed'],
	];
	for (const [state, conclusion, label] of results) {
		const status = repositoryGithubStatus(
			surface({
				pullRequest: openPullRequest({
					checkItems: [
						check({
							name: 'check, lint, test',
							state,
							conclusion,
							startedAt: '2026-07-22T08:00:00.000Z',
							completedAt: '2026-07-22T08:08:03.000Z',
						}),
					],
				}),
			}),
		);
		assert.equal(status?.checks[0]?.detail, `${label} · 8m 3s`, `${state} ${conclusion}`);
	}
});

test('formats bounded human-readable check durations', () => {
	assert.equal(
		pullRequestCheckDurationLabel('2026-07-22T08:00:00.000Z', '2026-07-22T08:01:05.000Z'),
		'1m 5s',
	);
	assert.equal(
		pullRequestCheckDurationLabel('2026-07-20T00:00:00.000Z', '2026-07-25T00:00:00.000Z'),
		'99h+',
	);
	assert.equal(pullRequestCheckDurationLabel('invalid', 'also-invalid'), null);
	assert.equal(pullRequestCheckDurationLabel(null, '2026-07-22T08:00:00.000Z'), null);
});

test('carries the GitHub session verdict without giving it a second voice', () => {
	const expired =
		'API request failed: POST /api/auth/github/refresh 502: {"message":"GitHub OAuth refresh failed: The client_id and/or client_secret passed are incorrect.","error":"Bad Gateway","statusCode":502}';

	assert.equal(
		repositoryGithubStatus(surface({ pullRequest: openPullRequest() }))?.session,
		'usable',
	);
	assert.equal(
		repositoryGithubStatus(surface({ error: 'checks endpoint failed' }))?.session,
		'usable',
	);

	for (const slot of ['error', 'pullRequestError', 'localError'] as const) {
		assert.equal(
			repositoryGithubStatus(surface({ [slot]: expired }))?.session,
			'reconnect-required',
			`a finished session reported through ${slot} must still be read as one`,
		);
	}

	const expiredStatus = repositoryGithubStatus(
		surface({ pullRequest: openPullRequest(), error: expired }),
	);
	const liveStatus = repositoryGithubStatus(surface({ pullRequest: openPullRequest() }));
	assert.ok(expiredStatus);
	assert.ok(liveStatus);
	assert.equal(expiredStatus.checksSummary, liveStatus.checksSummary);
	assert.deepEqual(expiredStatus.review, liveStatus.review);
	assert.deepEqual(expiredStatus.todos, liveStatus.todos);
	assert.equal(expiredStatus.reference, liveStatus.reference);
});
