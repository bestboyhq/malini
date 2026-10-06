import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXTENSION_EVENTS } from '@malini/extension-api';
import { extensionCommands } from '$shared/extensions/commands.store.svelte';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { activeWorkstreamFreshnessPhaseQuery } from '$shared/repositories/application/queries/active-workstream-freshness-phase.query.svelte';
import { workstreamHasChangesQuery } from '$shared/repositories/application/queries/workstream-has-changes.query.svelte';
import { workstreamGitStatusAggregate } from '$shared/repositories/infrastructure/aggregates/workstream-git-status.aggregate.svelte';
import { followActiveWorkstreamHook } from './follow-active-workstream.hook';
import { keepActiveWorkstreamFreshHook } from './keep-active-workstream-fresh.hook';

const WORKTREE = {
	branch: 'malini/ws-a',
	dirtyPaths: ['src/a.ts'],
	conflictedPaths: [],
	ahead: 0,
	behind: 0,
	hasUpstream: true,
	mergeInProgress: false,
	headSha: null,
};

let platform: FakePlatform;
let releases: (() => void)[] = [];

beforeEach(() => {
	platform = createFakePlatform({ workstreamStatuses: { 'ws-a': WORKTREE } });
	setPlatformForTest(platform);
	vi.spyOn(document, 'hasFocus').mockReturnValue(true);
});

afterEach(() => {
	for (const release of releases.splice(0)) release();
	workstreamGitStatusAggregate.reset();
	setPlatformForTest(null);
	vi.restoreAllMocks();
});

function hold(release: () => void): void {
	releases.push(release);
}

describe('keeping the open workstream fresh', () => {
	it('defers the first refresh past the navigation paint, then refreshes every surface once', async () => {
		const emit = vi.spyOn(extensionCommands, 'emit').mockResolvedValue(undefined);
		hold(keepActiveWorkstreamFreshHook(() => 'idle'));

		hold(followActiveWorkstreamHook('ws-a', true));

		expect(activeWorkstreamFreshnessPhaseQuery.data).toBe('deferred');
		expect(workstreamHasChangesQuery.data).toBe(false);
		await vi.waitFor(() =>
			expect(activeWorkstreamFreshnessPhaseQuery.data).toBe('released-after-paint'),
		);
		await vi.waitFor(() => expect(workstreamHasChangesQuery.data).toBe(true));
		expect(emit.mock.calls).toEqual([
			[
				'ws-a',
				EXTENSION_EVENTS.repositoryRefreshRequested,
				{ workstreamId: 'ws-a', scope: 'local' },
			],
			[
				'ws-a',
				EXTENSION_EVENTS.repositoryRefreshRequested,
				{ workstreamId: 'ws-a', scope: 'pull-request' },
			],
		]);
		expect(platform.calls).toContainEqual({
			command: 'repositories.workstream-status',
			args: { workstreamId: 'ws-a' },
		});
	});

	it('forgets the previous workstream’s changes the moment the route moves', async () => {
		vi.spyOn(extensionCommands, 'emit').mockResolvedValue(undefined);
		hold(keepActiveWorkstreamFreshHook(() => 'idle'));
		const leaveFirst = followActiveWorkstreamHook('ws-a', true);
		await vi.waitFor(() => expect(workstreamHasChangesQuery.data).toBe(true));

		leaveFirst();
		hold(followActiveWorkstreamHook('', false));

		expect(workstreamHasChangesQuery.data).toBe(false);
		expect(activeWorkstreamFreshnessPhaseQuery.data).toBe('idle');
	});

	it('stops refreshing once released', async () => {
		const emit = vi.spyOn(extensionCommands, 'emit').mockResolvedValue(undefined);
		const release = keepActiveWorkstreamFreshHook(() => 'idle');
		release();

		hold(followActiveWorkstreamHook('ws-a', true));
		await vi.waitFor(() =>
			expect(activeWorkstreamFreshnessPhaseQuery.data).toBe('released-after-paint'),
		);
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(emit).not.toHaveBeenCalled();
		expect(platform.calls).toEqual([]);
	});
});
