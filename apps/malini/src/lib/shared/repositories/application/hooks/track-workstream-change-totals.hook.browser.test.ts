import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakePlatform } from '$shared/port/fake/create-fake-platform';
import {
	gate,
	installRepositoriesPlatform,
	resetRepositoriesState,
} from '$shared/repositories/application/provisioning.testkit';
import { refreshWorkstreamChangeTotalsCommand } from '$shared/repositories/application/commands/refresh-workstream-change-totals.command';
import { trackWorkstreamChangeTotalsCommand } from '$shared/repositories/application/commands/track-workstream-change-totals.command';
import { trackWorkstreamChangeTotalsHook } from '$shared/repositories/application/hooks/track-workstream-change-totals.hook';
import { workstreamSnapshotsHook } from '$shared/repositories/application/hooks/workstream-snapshots.hook';
import { changeTotalsQuery } from '$shared/repositories/application/queries/change-totals.query.svelte';
import type { WorkstreamChangeTotals } from '$shared/repositories/domain/workstream-snapshot';
import {
	WORKSTREAM_CHANGE_TOTALS_POLL_INTERVAL_MS,
	workstreamChangeTotalsAggregate,
} from '$shared/repositories/infrastructure/aggregates/change-totals.aggregate.svelte';

const releases: Array<() => void> = [];
let platform: FakePlatform;
let totals: WorkstreamChangeTotals;

beforeEach(() => {
	platform = installRepositoriesPlatform();
	totals = { additions: 3, deletions: 1, files: 1 };
	platform.define('repositories.workstream-snapshot', () => ({ patch: '', totals }));
});

afterEach(() => {
	for (const release of releases.splice(0)) release();
	vi.useRealTimers();
	workstreamSnapshotsHook().clear();
	workstreamChangeTotalsAggregate.reset();
	resetRepositoriesState();
});

function snapshotReads(): unknown[] {
	return platform.calls
		.filter(({ command }) => command === 'repositories.workstream-snapshot')
		.map(({ args }) => args);
}

function track(): () => void {
	const release = trackWorkstreamChangeTotalsHook();
	releases.push(release);
	return release;
}

describe('tracking workstream change totals', () => {
	it('reads totals of the tracked workstreams from the shared snapshot cache', async () => {
		track();

		trackWorkstreamChangeTotalsCommand([{ id: 'ws-a', baseBranch: 'main' }]);

		await vi.waitFor(() =>
			expect(changeTotalsQuery.data['ws-a']).toEqual({ additions: 3, deletions: 1, files: 1 }),
		);
		expect(snapshotReads()).toEqual([{ workstreamId: 'ws-a', baseBranch: 'main' }]);
		await expect(
			workstreamSnapshotsHook().get({ workstreamId: 'ws-a', baseBranch: 'main' }),
		).resolves.toMatchObject({ totals: { additions: 3, deletions: 1, files: 1 } });
		expect(snapshotReads()).toHaveLength(1);
	});

	it('refreshes one workstream past the cached snapshot', async () => {
		track();
		trackWorkstreamChangeTotalsCommand([{ id: 'ws-a', baseBranch: 'main' }]);
		await vi.waitFor(() => expect(changeTotalsQuery.data['ws-a']?.additions).toBe(3));

		totals = { additions: 8, deletions: 2, files: 1 };
		refreshWorkstreamChangeTotalsCommand('ws-a');

		await vi.waitFor(() =>
			expect(changeTotalsQuery.data['ws-a']).toEqual({ additions: 8, deletions: 2, files: 1 }),
		);
	});

	it('polls only while tracked', async () => {
		vi.useFakeTimers();
		const release = track();
		trackWorkstreamChangeTotalsCommand([{ id: 'ws-a', baseBranch: 'main' }]);
		await vi.advanceTimersByTimeAsync(0);
		expect(snapshotReads()).toHaveLength(1);

		await vi.advanceTimersByTimeAsync(WORKSTREAM_CHANGE_TOTALS_POLL_INTERVAL_MS);
		expect(snapshotReads()).toHaveLength(2);

		release();

		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(WORKSTREAM_CHANGE_TOTALS_POLL_INTERVAL_MS);
		expect(snapshotReads()).toHaveLength(2);
	});

	it('shows the cached totals the moment the sidebar comes back and revalidates them in place', async () => {
		const release = track();
		trackWorkstreamChangeTotalsCommand([{ id: 'ws-a', baseBranch: 'main' }]);
		await vi.waitFor(() => expect(changeTotalsQuery.data['ws-a']?.additions).toBe(3));
		release();
		expect(changeTotalsQuery.data['ws-a']).toEqual({ additions: 3, deletions: 1, files: 1 });

		const revalidation = gate<WorkstreamChangeTotals>();
		platform.define('repositories.workstream-snapshot', async () => ({
			patch: '',
			totals: await revalidation.promise,
		}));
		track();
		trackWorkstreamChangeTotalsCommand([{ id: 'ws-a', baseBranch: 'main' }]);

		expect(changeTotalsQuery.data['ws-a']).toEqual({ additions: 3, deletions: 1, files: 1 });
		await vi.waitFor(() => expect(snapshotReads()).toHaveLength(2));
		expect(changeTotalsQuery.data['ws-a']).toEqual({ additions: 3, deletions: 1, files: 1 });

		revalidation.resolve({ additions: 5, deletions: 4, files: 1 });
		await vi.waitFor(() =>
			expect(changeTotalsQuery.data['ws-a']).toEqual({ additions: 5, deletions: 4, files: 1 }),
		);
		expect(snapshotReads()).toHaveLength(2);
	});
});
