import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepositorySurface } from '$lib/pull-requests/domain/repository-surface';
import { pullRequestStateAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-state.aggregate.svelte';
import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';
import { acceptRepositorySurfaceCommand } from './accept-repository-surface.command';

afterEach(() => {
	repositorySurfaceAggregate.clear();
	vi.restoreAllMocks();
});

function surface(
	state: 'open' | 'merged',
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
		pullRequest: {
			state,
			number: 3,
			url: 'https://github.com/acme/repo/pull/3',
			headSha: 'a'.repeat(40),
			githubLagsPush: false,
			mergeable: null,
			mergeableState: null,
			behindBase: null,
			checks: 'success',
			checksHeadline: 'Checks passed',
			checkItems: [],
			reviewDecision: null,
			unresolvedReviewThreadCount: 0,
			reviewStatusUnavailable: false,
			viewerCanMerge: true,
			mergeReadiness: 'ready',
			mergeMethod: 'squash',
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
		github: null,
		...overrides,
	};
}

describe('acceptRepositorySurfaceCommand', () => {
	it('hands the sidebar the pull request state of every surface that read it', () => {
		const observe = vi.spyOn(pullRequestStateAggregate, 'observe').mockReturnValue(undefined);

		acceptRepositorySurfaceCommand('ws-1', surface('open'));
		acceptRepositorySurfaceCommand('ws-1', surface('open', { dirtyPaths: ['next.ts'] }));
		acceptRepositorySurfaceCommand('ws-1', surface('merged'));

		expect(observe.mock.calls).toEqual([
			['ws-1', 'ready'],
			['ws-1', 'ready'],
			['ws-1', 'merged'],
		]);
	});

	it('leaves the sidebar alone while the pull request is still being read or belongs elsewhere', () => {
		const observe = vi.spyOn(pullRequestStateAggregate, 'observe').mockReturnValue(undefined);

		acceptRepositorySurfaceCommand(
			'ws-1',
			surface('merged', { pullRequestRefreshStatus: 'loading' }),
		);
		acceptRepositorySurfaceCommand('ws-1', surface('merged', { pullRequest: null }));
		acceptRepositorySurfaceCommand('ws-1', surface('merged', { workstreamId: 'ws-2' }));

		expect(observe).not.toHaveBeenCalled();
	});
});
