import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
		...UNOBSERVED_WORKSTREAM_CHECKOUT,
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
	vi.useFakeTimers();
	workstreamsAggregate.reset();
	nativeInventoryReports(workstream('a'), workstream('b'));
});

afterEach(async () => {
	await vi.runAllTimersAsync();
	vi.useRealTimers();
});

describe('retiring a workstream', () => {
	it('removes the row before the control plane is asked for anything', () => {
		let asked = false;
		workstreamRetirementStore.retire({
			workstreamId: 'a',
			commit: async () => {
				asked = true;
			},
		});

		expect(visibleIds()).toEqual(['b']);
		expect(asked).toBe(false);
	});

	it('deletes once the undo window closes', async () => {
		const commit = vi.fn(async () => {});
		const settled = workstreamRetirementStore.retire({
			workstreamId: 'a',
			commit,
			undoWindowMs: 5000,
		});

		await vi.advanceTimersByTimeAsync(4999);
		expect(commit).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		await expect(settled).resolves.toEqual({ status: 'retired' });
		expect(commit).toHaveBeenCalledTimes(1);
		expect(visibleIds()).toEqual(['b']);
	});

	it('restores the row and never touches the disk when undone', async () => {
		const commit = vi.fn(async () => {});
		const settled = workstreamRetirementStore.retire({
			workstreamId: 'a',
			commit,
		});

		workstreamRetirementStore.undo('a');
		expect(visibleIds()).toContain('a');

		await vi.advanceTimersByTimeAsync(60_000);
		expect(commit).not.toHaveBeenCalled();
		await expect(settled).resolves.toEqual({ status: 'undone' });
	});

	it('stays hidden when a native read reports it still exists', () => {
		workstreamRetirementStore.retire({
			workstreamId: 'a',
			commit: async () => {},
		});

		nativeInventoryReports(workstream('a'), workstream('b'));

		expect(visibleIds()).toEqual(['b']);
	});

	it('lets the row come back once the delete has landed', async () => {
		workstreamRetirementStore.retire({
			workstreamId: 'a',
			commit: async () => {},
			undoWindowMs: 10,
		});
		await vi.advanceTimersByTimeAsync(10);

		nativeInventoryReports(workstream('a'), workstream('b'));

		expect(visibleIds()).toContain('a');
	});

	it('brings the row back and reports why when the delete fails', async () => {
		const settled = workstreamRetirementStore.retire({
			workstreamId: 'a',
			commit: async () => {
				throw new Error('worktree is locked');
			},
			undoWindowMs: 10,
		});

		await vi.advanceTimersByTimeAsync(10);

		await expect(settled).resolves.toEqual({
			status: 'failed',
			message: 'worktree is locked',
		});
		expect(visibleIds()).toContain('a');
	});

	it('answers a second click on a row already retiring by doing nothing', () => {
		const commit = vi.fn(async () => {});
		workstreamRetirementStore.retire({ workstreamId: 'a', commit });
		const second = workstreamRetirementStore.retire({
			workstreamId: 'a',
			commit,
		});

		expect(second).toBeNull();
		expect(workstreamRetirementStore.isPending('a')).toBe(true);
	});
});
