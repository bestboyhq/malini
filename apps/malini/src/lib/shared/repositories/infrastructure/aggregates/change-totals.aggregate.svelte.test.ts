import { describe, expect, it, vi } from 'vitest';
import {
	WORKSTREAM_CHANGE_TOTALS_POLL_INTERVAL_MS,
	WorkstreamChangeTotalsAggregate,
} from './change-totals.aggregate.svelte';

function resolverAt<T>(resolvers: readonly T[], index: number): T {
	const resolver = resolvers[index];
	if (!resolver) throw new Error(`expected a pending read at index ${index}`);
	return resolver;
}

describe('WorkstreamChangeTotalsAggregate', () => {
	it('uses event refreshes as the fast path and keeps the full Git sweep slow', () => {
		expect(WORKSTREAM_CHANGE_TOTALS_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(60_000);
	});

	it('bounds invalid polling intervals and ignores a stale polling disposer', () => {
		const intervalSpy = vi.spyOn(globalThis, 'setInterval');
		const clearSpy = vi.spyOn(globalThis, 'clearInterval');
		const aggregate = new WorkstreamChangeTotalsAggregate(async () => ({
			additions: 0,
			deletions: 0,
			files: 0,
		}));

		try {
			const stopFirst = aggregate.startPolling(0);
			expect(intervalSpy).toHaveBeenLastCalledWith(
				expect.any(Function),
				WORKSTREAM_CHANGE_TOTALS_POLL_INTERVAL_MS,
			);

			const stopReplacement = aggregate.startPolling(125);
			const replacementTimer = intervalSpy.mock.results.at(-1)?.value;
			stopFirst();
			expect(clearSpy).not.toHaveBeenCalledWith(replacementTimer);

			stopReplacement();
			expect(clearSpy).toHaveBeenCalledWith(replacementTimer);
		} finally {
			aggregate.stopPolling();
			intervalSpy.mockRestore();
			clearSpy.mockRestore();
		}
	});

	it('loads each tracked workstream against its own base branch', async () => {
		const calls: TotalsTarget[] = [];
		const aggregate = new WorkstreamChangeTotalsAggregate(async (input) => {
			calls.push(input);
			return input.workstreamId === 'workstream-a'
				? { additions: 21, deletions: 5, files: 1 }
				: { additions: 8, deletions: 0, files: 1 };
		});

		await aggregate.track([
			{ id: 'workstream-a', baseBranch: 'main' },
			{ id: 'workstream-b', baseBranch: 'develop' },
		]);

		expect(calls).toEqual([
			{ workstreamId: 'workstream-a', baseBranch: 'main' },
			{ workstreamId: 'workstream-b', baseBranch: 'develop' },
		]);
		expect(aggregate.totalsByWorkstream).toEqual({
			'workstream-a': { additions: 21, deletions: 5, files: 1 },
			'workstream-b': { additions: 8, deletions: 0, files: 1 },
		});
	});

	it('does not let an obsolete Git scan restore a removed sidebar row', async () => {
		let resolveScan: (totals: {
			additions: number;
			deletions: number;
			files: number;
		}) => void = () => {
			throw new Error('scan resolver was not installed');
		};
		const aggregate = new WorkstreamChangeTotalsAggregate(
			() =>
				new Promise((resolve) => {
					resolveScan = resolve;
				}),
		);

		const pending = aggregate.track([{ id: 'removed', baseBranch: 'main' }]);
		await aggregate.track([]);
		resolveScan({ additions: 99, deletions: 42, files: 1 });
		await pending;

		expect(aggregate.totalsByWorkstream).toEqual({});
		expect(aggregate.loadingByWorkstream).toEqual({});
	});

	it('keeps the last trustworthy totals when a later refresh fails', async () => {
		let shouldFail = false;
		const aggregate = new WorkstreamChangeTotalsAggregate(async () => {
			if (shouldFail) throw new Error('git worktree is temporarily locked');
			return { additions: 13.8, deletions: -3, files: 1 };
		});

		await aggregate.track([{ id: 'workstream-a', baseBranch: 'main' }]);
		shouldFail = true;
		await aggregate.refreshWorkstream('workstream-a');

		expect(aggregate.totalsByWorkstream['workstream-a']).toEqual({
			additions: 13,
			deletions: 0,
			files: 1,
		});
		expect(aggregate.lastErrorByWorkstream['workstream-a']).toBe(
			'git worktree is temporarily locked',
		);
	});

	it('coalesces a refresh burst into one scan plus one trailing scan', async () => {
		const resolvers: Array<
			(totals: { additions: number; deletions: number; files: number }) => void
		> = [];
		const aggregate = new WorkstreamChangeTotalsAggregate(
			() => new Promise((resolve) => resolvers.push(resolve)),
		);
		const initial = aggregate.track([{ id: 'workstream-a', baseBranch: 'main' }]);
		expect(resolvers).toHaveLength(1);

		const one = aggregate.refreshWorkstream('workstream-a');
		const two = aggregate.refreshWorkstream('workstream-a');
		const three = aggregate.refreshWorkstream('workstream-a');
		expect(resolvers).toHaveLength(1);

		resolverAt(resolvers, 0)({ additions: 1, deletions: 0, files: 1 });
		await Promise.resolve();
		await Promise.resolve();
		expect(resolvers).toHaveLength(2);
		resolverAt(resolvers, 1)({ additions: 4, deletions: 2, files: 1 });
		await Promise.all([initial, one, two, three]);

		expect(resolvers).toHaveLength(2);
		expect(aggregate.totalsByWorkstream['workstream-a']).toEqual({
			additions: 4,
			deletions: 2,
			files: 1,
		});
	});

	it('joins an initial scan without invalidating it or forcing a trailing scan', async () => {
		const resolvers: Array<
			(totals: { additions: number; deletions: number; files: number }) => void
		> = [];
		const aggregate = new WorkstreamChangeTotalsAggregate(
			() => new Promise((resolve) => resolvers.push(resolve)),
		);
		const initial = aggregate.track([{ id: 'workstream-a', baseBranch: 'main' }]);
		const ensured = aggregate.ensureWorkstream('workstream-a');

		expect(resolvers).toHaveLength(1);
		resolverAt(resolvers, 0)({ additions: 9, deletions: 2, files: 1 });
		await Promise.all([initial, ensured]);

		expect(resolvers).toHaveLength(1);
		expect(aggregate.totalsByWorkstream['workstream-a']).toEqual({
			additions: 9,
			deletions: 2,
			files: 1,
		});
	});

	it('does not publish either pass after a coalesced target is removed', async () => {
		const resolvers: Array<
			(totals: { additions: number; deletions: number; files: number }) => void
		> = [];
		const aggregate = new WorkstreamChangeTotalsAggregate(
			() => new Promise((resolve) => resolvers.push(resolve)),
		);
		const initial = aggregate.track([{ id: 'removed', baseBranch: 'main' }]);
		const trailing = aggregate.refreshWorkstream('removed');
		await aggregate.track([]);

		resolverAt(resolvers, 0)({ additions: 99, deletions: 42, files: 1 });
		await Promise.all([initial, trailing]);

		expect(resolvers).toHaveLength(1);
		expect(aggregate.totalsByWorkstream).toEqual({});
		expect(aggregate.loadingByWorkstream).toEqual({});
	});

	it('retires an in-flight base branch and runs one trailing scan for the retargeted row', async () => {
		const calls: TotalsTarget[] = [];
		const resolvers: Array<
			(totals: { additions: number; deletions: number; files: number }) => void
		> = [];
		const aggregate = new WorkstreamChangeTotalsAggregate(
			(input) =>
				new Promise((resolve) => {
					calls.push(input);
					resolvers.push(resolve);
				}),
		);
		const initial = aggregate.track([{ id: 'retargeted', baseBranch: 'main' }]);
		const retargeted = aggregate.track([{ id: 'retargeted', baseBranch: 'release' }]);

		resolverAt(resolvers, 0)({ additions: 100, deletions: 50, files: 1 });
		await Promise.resolve();
		await Promise.resolve();
		expect(calls).toEqual([
			{ workstreamId: 'retargeted', baseBranch: 'main' },
			{ workstreamId: 'retargeted', baseBranch: 'release' },
		]);

		resolverAt(resolvers, 1)({ additions: 7, deletions: 3, files: 1 });
		await Promise.all([initial, retargeted]);
		expect(aggregate.totalsByWorkstream.retargeted).toEqual({
			additions: 7,
			deletions: 3,
			files: 1,
		});
	});
});

type TotalsTarget = { workstreamId: string; baseBranch: string };
