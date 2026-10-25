import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	UNOBSERVED_WORKSTREAM_CHECKOUT,
	type Workstream,
} from '$shared/repositories/repositories.api';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { workstreamRetirementStore } from './workstream-retirement.store.svelte';

function workstream(id: string): Workstream {
	return {
		id,
		projectId: 'project-1',
		name: id,
		path: `/checkouts/${id}`,
		branch: `malini/${id}`,
		baseBranch: 'main',
		status: 'active',
		createdAt: '2026-10-24T00:00:00.000Z',
		activeAt: '2026-10-24T00:00:00.000Z',
		...UNOBSERVED_WORKSTREAM_CHECKOUT,
		scope: null,
		startedBy: null,
	};
}

function visibleIds(): string[] {
	return workstreamsAggregate.workstreams.map((entry) => entry.id);
}

function nativeInventoryReports(...workstreams: Workstream[]): void {
	for (const entry of workstreams) {
		workstreamsAggregate.upsert(entry);
	}
}

beforeEach(() => {
	workstreamsAggregate.reset();
	nativeInventoryReports(workstream('a'), workstream('b'));
});

function gate(): { promise: Promise<void>; open: () => void } {
	let open: () => void = () => undefined;
	const promise = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { promise, open };
}

describe('retiring a workstream', () => {
	it('removes the row before the platform answers', async () => {
		const answer = gate();
		const settled = workstreamRetirementStore.retire({
			workstreamId: 'a',
			commit: () => answer.promise,
		});

		expect(visibleIds()).toEqual(['b']);
		answer.open();
		await settled;
	});

	it('asks the platform at once', async () => {
		const commit = vi.fn(async () => {});
		const settled = workstreamRetirementStore.retire({ workstreamId: 'a', commit });

		await expect(settled).resolves.toEqual({ status: 'retired' });
		expect(commit).toHaveBeenCalledTimes(1);
		expect(visibleIds()).toEqual(['b']);
	});

	it('stays hidden when a native read reports it still exists', async () => {
		const answer = gate();
		const settled = workstreamRetirementStore.retire({
			workstreamId: 'a',
			commit: () => answer.promise,
		});

		nativeInventoryReports(workstream('a'), workstream('b'));

		expect(visibleIds()).toEqual(['b']);
		answer.open();
		await settled;
	});

	it('lets the row come back once the archive has landed', async () => {
		await workstreamRetirementStore.retire({ workstreamId: 'a', commit: async () => {} });

		nativeInventoryReports(workstream('a'), workstream('b'));

		expect(visibleIds()).toContain('a');
	});

	it('brings the row back and reports why when the archive fails', async () => {
		const settled = workstreamRetirementStore.retire({
			workstreamId: 'a',
			commit: async () => {
				throw new Error('worktree is locked');
			},
		});

		await expect(settled).resolves.toEqual({
			status: 'failed',
			message: 'worktree is locked',
		});
		expect(visibleIds()).toContain('a');
	});

	it('answers a second click on a row already retiring by doing nothing', async () => {
		const answer = gate();
		const commit = vi.fn(() => answer.promise);
		const settled = workstreamRetirementStore.retire({ workstreamId: 'a', commit });
		const second = workstreamRetirementStore.retire({ workstreamId: 'a', commit });

		expect(second).toBeNull();
		expect(commit).toHaveBeenCalledTimes(1);
		expect(workstreamRetirementStore.isRetiring('a')).toBe(true);
		answer.open();
		await settled;
		await vi.waitFor(() => expect(workstreamRetirementStore.isRetiring('a')).toBe(false));
	});
});
