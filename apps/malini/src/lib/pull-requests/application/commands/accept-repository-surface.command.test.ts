import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepositorySurface } from '$lib/pull-requests/domain/repository-surface';
import { pullRequestStateAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-state.aggregate.svelte';
import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';
import { acceptRepositorySurfaceCommand } from './accept-repository-surface.command';

afterEach(() => {
	repositorySurfaceAggregate.clear();
	vi.restoreAllMocks();
});

function surface(state: 'open' | 'merged', dirtyPaths: readonly string[] = []): RepositorySurface {
	return {
		status: 'ready',
		workstreamId: 'ws-1',
		branch: 'malini/ws-1',
		baseBranch: 'main',
		dirtyPaths,
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
	};
}

describe('acceptRepositorySurfaceCommand', () => {
	it('hands the sidebar a merge the open workstream sees, and re-reads a reopened pull request', () => {
		const observe = vi.spyOn(pullRequestStateAggregate, 'observe').mockReturnValue(undefined);
		const refresh = vi
			.spyOn(pullRequestStateAggregate, 'refreshWorkstream')
			.mockResolvedValue(undefined);

		acceptRepositorySurfaceCommand('ws-1', surface('open'));
		acceptRepositorySurfaceCommand('ws-1', surface('open', ['next.ts']));
		expect(observe).not.toHaveBeenCalled();
		expect(refresh).not.toHaveBeenCalled();

		acceptRepositorySurfaceCommand('ws-1', surface('merged'));
		expect(observe).toHaveBeenCalledExactlyOnceWith('ws-1', 'merged');

		acceptRepositorySurfaceCommand('ws-1', surface('open'));
		expect(refresh).toHaveBeenCalledExactlyOnceWith('ws-1');
	});
});
