import { describe, expect, it } from 'vitest';
import type { ExtensionPullRequestContext } from '@malini/extension-api';
import type { RepositorySurfaceState } from '@malini-extension/repository';

import { RepositorySurfaceMapper } from '$lib/pull-requests/infrastructure/mappers/repository-surface.mapper';
import {
	pullRequestRefreshActivity,
	surfaceMergedHead,
	type RepositorySurface,
} from './repository-surface';

function read(
	pullRequest: Partial<ExtensionPullRequestContext> | null,
	overrides: Partial<RepositorySurfaceState> = {},
): RepositorySurface {
	const surface: RepositorySurfaceState = {
		status: 'ready',
		workstreamId: 'workstream-1',
		branch: 'malini/workstream-1',
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
		pullRequest: pullRequest && {
			state: 'open',
			number: 7,
			title: 'Pull request',
			url: 'https://example.test/pull/7',
			baseBranch: 'main',
			headBranch: 'malini/workstream-1',
			headSha: 'head-7',
			mergeable: true,
			mergeableState: 'clean',
			checks: 'success',
			...pullRequest,
		},
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
	return RepositorySurfaceMapper.fromRaw(surface);
}

function activity(pullRequest: Partial<ExtensionPullRequestContext> | null): string {
	return pullRequestRefreshActivity(read(pullRequest));
}

const check = {
	name: 'test',
	appId: null,
	required: true,
	url: null,
	startedAt: null,
	completedAt: null,
};

describe('how eagerly the open workstream reads its pull request', () => {
	it.each([
		{ branch: 'GitHub has not seen the push', pullRequest: { includesLocalHead: false } },
		{ branch: 'checks are pending', pullRequest: { checks: 'pending' as const } },
		{ branch: 'mergeability is being computed', pullRequest: { mergeableState: 'UNKNOWN' } },
		{
			branch: 'one check failed while another is still in progress',
			pullRequest: {
				checks: 'failed' as const,
				checkItems: [
					{ ...check, state: 'COMPLETED', conclusion: 'FAILURE' },
					{ ...check, state: 'IN_PROGRESS', conclusion: null },
				],
			},
		},
	])('reads it at the running pace when $branch', ({ pullRequest }) => {
		expect(activity(pullRequest)).toBe('running');
	});

	it('backs off once GitHub has settled everything about the pushed head', () => {
		expect(activity({})).toBe('idle');
		expect(activity({ checks: 'failed' })).toBe('idle');
		expect(activity({ state: 'not_open', number: null })).toBe('idle');
		expect(activity(null)).toBe('idle');
	});

	it.each(['merged', 'closed'] as const)('stops reading a %s pull request', (state) => {
		expect(activity({ state, includesLocalHead: false, checks: 'pending' })).toBe('finished');
	});
});

describe('where a merged workstream continues from', () => {
	it('continues on top of its base from the head that merged', () => {
		expect(surfaceMergedHead(read({ state: 'merged' }))).toEqual({
			baseBranch: 'main',
			mergedHeadSha: 'head-7',
		});
	});

	it('leaves a workstream that is not merged, has no merged head or is mid-operation alone', () => {
		expect(surfaceMergedHead(read({}))).toBeNull();
		expect(surfaceMergedHead(read(null))).toBeNull();
		expect(surfaceMergedHead(read({ state: 'merged', headSha: null }))).toBeNull();
		expect(
			surfaceMergedHead(read({ state: 'merged' }, { operationInProgress: 'rebase' })),
		).toBeNull();
	});
});
