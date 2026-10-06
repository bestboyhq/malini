import { describe, expect, it, vi } from 'vitest';
import { summarizeAdditionsDeletions } from '$shared/repositories/domain/diff';
import type { WorkstreamSnapshot } from '$shared/repositories/domain/workstream-snapshot';
import { WorkstreamChangeTotalsAggregate } from '$shared/repositories/infrastructure/aggregates/change-totals.aggregate.svelte';
import { WorkstreamSnapshotsService } from './workstream-snapshots.service';

const workstream = { id: 'workstream-1', baseBranch: 'main' };
const target = { workstreamId: workstream.id, baseBranch: workstream.baseBranch };

function patch(lines: readonly string[]): string {
	return [
		'diff --git a/src/revision.ts b/src/revision.ts',
		'index 111..222 100644',
		'--- a/src/revision.ts',
		'+++ b/src/revision.ts',
		`@@ -0,0 +1,${lines.length} @@`,
		...lines.map((line) => `+${line}`),
	].join('\n');
}

describe('WorkstreamSnapshotsService', () => {
	it('coalesces sidebar totals and Changes onto one invalidated snapshot revision', async () => {
		let revision = 1;
		const load = vi.fn(async (): Promise<WorkstreamSnapshot> => ({
			patch: patch(Array.from({ length: revision }, (_, index) => `revision-${index + 1}`)),
			totals: { additions: revision, deletions: 0, files: 1 },
		}));
		const snapshots = new WorkstreamSnapshotsService(load);
		const totals = new WorkstreamChangeTotalsAggregate(snapshots);

		const initialTotals = totals.track([{ id: workstream.id, baseBranch: workstream.baseBranch }]);
		const initialChanges = snapshots.get(target);
		await initialTotals;
		const changes = await initialChanges;

		expect(load).toHaveBeenCalledTimes(1);
		expect(totals.totalsByWorkstream[workstream.id]).toEqual({
			additions: 1,
			deletions: 0,
			files: 1,
		});
		expect(summarizeAdditionsDeletions(changes.patch).additions).toBe(1);

		revision = 2;
		const refreshedTotals = totals.refreshWorkstream(workstream.id);
		const refreshedChanges = await snapshots.get(target);
		await refreshedTotals;

		expect(load).toHaveBeenCalledTimes(2);
		expect(totals.totalsByWorkstream[workstream.id]).toEqual({
			additions: 2,
			deletions: 0,
			files: 1,
		});
		expect(summarizeAdditionsDeletions(refreshedChanges.patch).additions).toBe(2);
	});

	it('does not publish an obsolete workstream result after switching rows', async () => {
		const resolvers = new Map<string, (snapshot: WorkstreamSnapshot) => void>();
		const snapshots = new WorkstreamSnapshotsService(
			(input) =>
				new Promise((resolve) => {
					resolvers.set(input.workstreamId, resolve);
				}),
		);
		const totals = new WorkstreamChangeTotalsAggregate(snapshots);

		const oldTrack = totals.track([{ id: 'old', baseBranch: 'main' }]);
		const nextTrack = totals.track([{ id: 'next', baseBranch: 'release' }]);
		resolvers.get('old')?.({
			patch: patch(['old']),
			totals: { additions: 99, deletions: 9, files: 1 },
		});
		resolvers.get('next')?.({
			patch: patch(['next']),
			totals: { additions: 1, deletions: 0, files: 1 },
		});
		await Promise.all([oldTrack, nextTrack]);

		expect(totals.totalsByWorkstream).toEqual({ next: { additions: 1, deletions: 0, files: 1 } });
	});
});
