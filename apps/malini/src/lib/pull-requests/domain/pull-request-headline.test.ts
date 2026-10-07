import { describe, expect, it } from 'vitest';
import { pullRequestHeadline } from './pull-request-headline';
import type {
	RepositorySurface,
	SurfacePullRequest,
	SurfacePullRequestCheck,
} from './repository-surface';

function check(overrides: Partial<SurfacePullRequestCheck> = {}): SurfacePullRequestCheck {
	return {
		name: 'test',
		appId: 15_368,
		state: 'completed',
		conclusion: 'success',
		required: null,
		passed: true,
		failed: false,
		notStartedReason: null,
		...overrides,
	};
}

const running = check({ state: 'in_progress', conclusion: null, passed: false });
const failed = check({ conclusion: 'failure', passed: false, failed: true });

function pullRequest(overrides: Partial<SurfacePullRequest> = {}): SurfacePullRequest {
	return {
		state: 'open',
		number: 17,
		url: 'https://github.com/acme/repo/pull/17',
		headSha: 'a'.repeat(40),
		githubLagsPush: false,
		mergeable: true,
		mergeableState: 'clean',
		behindBase: 0,
		checks: 'success',
		checksHeadline: 'Checks passed',
		checkItems: [check(), check({ name: 'lint' })],
		reviewDecision: null,
		unresolvedReviewThreadCount: 0,
		reviewStatusUnavailable: false,
		viewerCanMerge: true,
		mergeReadiness: 'ready',
		mergeMethod: 'squash',
		...overrides,
	};
}

function surface(
	pullRequestOverrides: Partial<SurfacePullRequest> | null,
	overrides: Partial<RepositorySurface> = {},
): RepositorySurface {
	return {
		status: 'ready',
		workstreamId: 'ws-1',
		branch: 'malini/ws-1',
		baseBranch: 'main',
		dirtyPaths: [],
		conflictedPaths: [],
		conflictMarkerPaths: [],
		changedFiles: 1,
		ahead: 0,
		behind: 0,
		hasUpstream: true,
		mergeInProgress: false,
		operationInProgress: null,
		pullRequest: pullRequestOverrides === null ? null : pullRequest(pullRequestOverrides),
		pullRequestRefreshStatus: 'ready',
		pullRequestRefreshedAt: 1,
		pullRequestSettledAt: 1,
		localError: null,
		pullRequestError: null,
		error: null,
		todoStatus: 'ready',
		todoOpenCount: 0,
		todoError: null,
		github: null,
		...overrides,
	};
}

describe('pullRequestHeadline', () => {
	it('says nothing before a pull request exists', () => {
		expect(pullRequestHeadline(null)).toBeNull();
		expect(pullRequestHeadline(surface(null))).toBeNull();
		expect(pullRequestHeadline(surface({ state: 'not_open', number: null }))).toBeNull();
	});

	it.each([
		{
			moment: 'GitHub has not registered the checks of a fresh head yet',
			scenario: surface({ checks: 'pending', checkItems: [] }),
			expected: { label: 'Waiting for checks…', tone: 'progress' },
		},
		{
			moment: 'checks are running',
			scenario: surface({ checks: 'pending', checkItems: [running, running, check(), running] }),
			expected: { label: '3 checks pending…', tone: 'progress' },
		},
		{
			moment: 'one check is left',
			scenario: surface({ checks: 'pending', checkItems: [check(), running] }),
			expected: { label: '1 check pending…', tone: 'progress' },
		},
		{
			moment: 'every check passed',
			scenario: surface({}),
			expected: { label: 'Checks passed', tone: 'success' },
		},
		{
			moment: 'only an optional check failed',
			scenario: surface({ checkItems: [check(), { ...failed, required: false }] }),
			expected: { label: '1 optional check failed', tone: 'success' },
		},
		{
			moment: 'a required check failed',
			scenario: surface({ checks: 'failed', checkItems: [check(), failed, failed] }),
			expected: { label: '2 checks failed', tone: 'danger' },
		},
		{
			moment: 'a reviewer requested changes',
			scenario: surface({ reviewDecision: 'changes_requested' }),
			expected: { label: 'Changes requested', tone: 'danger' },
		},
		{
			moment: 'the branch conflicts with its base',
			scenario: surface({ mergeable: false, mergeableState: 'dirty' }),
			expected: { label: 'Merge conflicts', tone: 'danger' },
		},
		{
			moment: 'the base moved on',
			scenario: surface({ mergeableState: 'behind' }),
			expected: { label: 'Behind main', tone: 'warning' },
		},
		{
			moment: 'GitHub has not picked up the latest push',
			scenario: surface({ githubLagsPush: true }),
			expected: { label: 'Waiting for GitHub…', tone: 'progress' },
		},
		{
			moment: 'the pull request merged',
			scenario: surface({ state: 'merged' }, { dirtyPaths: ['next.ts'] }),
			expected: { label: 'Merged', tone: 'merged' },
		},
	])('reads "$expected.label" when $moment', ({ scenario, expected }) => {
		expect(pullRequestHeadline(scenario)).toEqual(expected);
	});
});
