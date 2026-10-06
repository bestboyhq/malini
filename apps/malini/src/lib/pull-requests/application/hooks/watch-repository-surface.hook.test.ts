import type { RepositorySurfaceState } from '@malini-extension/repository';
import { afterEach, describe, expect, it } from 'vitest';

import { extensionCommands } from '$shared/extensions/commands.store.svelte';
import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';
import { watchRepositorySurfaceHook } from './watch-repository-surface.hook';

afterEach(() => {
	repositorySurfaceAggregate.clear();
});

describe('watchRepositorySurfaceHook', () => {
	it('keeps a surface read ahead for another workstream, ready for its first visit', () => {
		const listeners: Array<(payload: unknown) => void> = [];
		const disconnect = extensionCommands.connect({
			workstreamId: () => 'workstream-route',
			execute: async () => undefined,
			emit: async () => undefined,
			onEvent: (_channel, listener) => {
				listeners.push(listener);
				return () => listeners.splice(listeners.indexOf(listener), 1);
			},
		});
		const stop = watchRepositorySurfaceHook(() => 'workstream-route');

		for (const listener of listeners) listener(readSurface('workstream-warmed'));

		expect(repositorySurfaceAggregate.presentedSurfaceFor('workstream-warmed')?.branch).toBe(
			'feature/workstream-warmed',
		);
		expect(repositorySurfaceAggregate.surfaceFor('workstream-route')).toBeNull();
		stop();
		disconnect();
	});
});

function readSurface(workstreamId: string): RepositorySurfaceState {
	return {
		status: 'ready',
		workstreamId,
		branch: `feature/${workstreamId}`,
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
	};
}
