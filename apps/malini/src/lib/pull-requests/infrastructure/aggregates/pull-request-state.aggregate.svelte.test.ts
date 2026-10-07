import { describe, expect, it, vi } from 'vitest';
import {
	PULL_REQUEST_STATE_POLL_INTERVAL_MS,
	type PullRequestState,
	type PullRequestTarget,
} from '$lib/pull-requests/domain/pull-request-state';
import { PullRequestStateAggregate } from './pull-request-state.aggregate.svelte';

type PullRequestStateLoader = (
	targets: readonly PullRequestTarget[],
) => Promise<Readonly<Record<string, PullRequestState>>>;

function resolverAt<T>(resolvers: readonly T[], index: number): T {
	const resolver = resolvers[index];
	if (!resolver) throw new Error(`expected a pending read at index ${index}`);
	return resolver;
}

function target(overrides: Partial<PullRequestTarget> = {}): PullRequestTarget {
	return {
		workstreamId: 'workstream-a',
		repoId: 'repo-1',
		head: 'feature-a',
		base: 'main',
		...overrides,
	};
}

async function flush(ticks = 12): Promise<void> {
	for (let index = 0; index < ticks; index += 1) await Promise.resolve();
}

describe('PullRequestStateAggregate', () => {
	it('polls every five minutes because each read costs several GitHub calls', () => {
		expect(PULL_REQUEST_STATE_POLL_INTERVAL_MS).toBe(5 * 60_000);
	});

	it('bounds invalid polling intervals and ignores a stale polling disposer', () => {
		const intervalSpy = vi.spyOn(globalThis, 'setInterval');
		const clearSpy = vi.spyOn(globalThis, 'clearInterval');
		const aggregate = new PullRequestStateAggregate(async () => ({}));

		try {
			const stopFirst = aggregate.startPolling(0);
			expect(intervalSpy).toHaveBeenLastCalledWith(
				expect.any(Function),
				PULL_REQUEST_STATE_POLL_INTERVAL_MS,
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

	it('tracks new workstreams and batches them per repository', async () => {
		const calls: PullRequestTarget[][] = [];
		const aggregate = new PullRequestStateAggregate(async (targets) => {
			calls.push([...targets]);
			return Object.fromEntries(
				targets.map((entry) => [
					entry.workstreamId,
					entry.workstreamId === 'workstream-a' ? 'ready' : 'draft',
				]),
			);
		});

		await aggregate.track([
			target({ workstreamId: 'workstream-a' }),
			target({ workstreamId: 'workstream-b', head: 'feature-b' }),
			target({ workstreamId: 'workstream-c', repoId: 'repo-2', head: 'feature-c' }),
		]);

		expect(calls).toHaveLength(2);
		expect(calls[0]?.map((entry) => entry.workstreamId)).toEqual(['workstream-a', 'workstream-b']);
		expect(calls[1]?.map((entry) => entry.workstreamId)).toEqual(['workstream-c']);
		expect(aggregate.stateByWorkstream).toEqual({
			'workstream-a': 'ready',
			'workstream-b': 'draft',
			'workstream-c': 'draft',
		});
	});

	it('evicts workstreams that disappeared and only loads the new ones', async () => {
		const calls: string[][] = [];
		const aggregate = new PullRequestStateAggregate(async (targets) => {
			calls.push(targets.map((entry) => entry.workstreamId));
			return Object.fromEntries(targets.map((entry) => [entry.workstreamId, 'open' as const]));
		});

		await aggregate.track([
			target({ workstreamId: 'workstream-a' }),
			target({ workstreamId: 'workstream-b', head: 'feature-b' }),
		]);
		await aggregate.track([
			target({ workstreamId: 'workstream-a' }),
			target({ workstreamId: 'workstream-c', head: 'feature-c' }),
		]);

		expect(calls).toEqual([['workstream-a', 'workstream-b'], ['workstream-c']]);
		expect(aggregate.stateByWorkstream).toEqual({
			'workstream-a': 'open',
			'workstream-c': 'open',
		});
		expect(aggregate.lastErrorByWorkstream).toEqual({
			'workstream-a': null,
			'workstream-c': null,
		});
		expect(aggregate.stateFor('workstream-b')).toBe('unknown');
	});

	it('seeds a freshly tracked workstream with unknown rather than none', () => {
		const aggregate = new PullRequestStateAggregate(
			() => new Promise<Record<string, PullRequestState>>(() => undefined),
		);
		void aggregate.track([target()]);

		expect(aggregate.stateByWorkstream).toEqual({ 'workstream-a': 'unknown' });
		expect(aggregate.loadingByWorkstream).toEqual({ 'workstream-a': true });
	});

	it('does not let an obsolete read restore a removed sidebar row', async () => {
		let resolveRead: (states: Record<string, PullRequestState>) => void = () => {
			throw new Error('read resolver was not installed');
		};
		const aggregate = new PullRequestStateAggregate(
			() =>
				new Promise((resolve) => {
					resolveRead = resolve;
				}),
		);

		const pending = aggregate.track([target({ workstreamId: 'removed' })]);
		await aggregate.track([]);
		resolveRead({ removed: 'ready' });
		await pending;

		expect(aggregate.stateByWorkstream).toEqual({});
		expect(aggregate.loadingByWorkstream).toEqual({});
	});

	it('does not let a stale in-flight read overwrite a newer branch target', async () => {
		const calls: PullRequestTarget[][] = [];
		const resolvers: Array<(states: Record<string, PullRequestState>) => void> = [];
		const aggregate = new PullRequestStateAggregate(
			(targets) =>
				new Promise((resolve) => {
					calls.push([...targets]);
					resolvers.push(resolve);
				}),
		);

		const initial = aggregate.track([target({ workstreamId: 'retargeted', head: 'feature-old' })]);
		const retargeted = aggregate.track([
			target({ workstreamId: 'retargeted', head: 'feature-new' }),
		]);

		resolverAt(resolvers, 0)({ retargeted: 'merged' });
		await flush();
		expect(calls.map((entry) => entry[0]?.head)).toEqual(['feature-old', 'feature-new']);
		expect(aggregate.stateByWorkstream.retargeted).toBe('unknown');

		resolverAt(resolvers, 1)({ retargeted: 'ready' });
		await Promise.all([initial, retargeted]);
		expect(aggregate.stateByWorkstream.retargeted).toBe('ready');
	});

	it('takes a merge the open workstream observed over a stale read still in flight', async () => {
		const resolvers: Array<(states: Record<string, PullRequestState>) => void> = [];
		const aggregate = new PullRequestStateAggregate(
			() => new Promise((resolve) => resolvers.push(resolve)),
		);
		const tracked = aggregate.track([target()]);

		aggregate.observe('workstream-a', 'merged');
		aggregate.observe('untracked', 'merged');
		resolverAt(resolvers, 0)({ 'workstream-a': 'open' });
		await tracked;

		expect(aggregate.stateFor('workstream-a')).toBe('merged');
		expect(aggregate.loadingByWorkstream['workstream-a']).toBe(false);
		expect(aggregate.stateByWorkstream).not.toHaveProperty('untracked');
	});

	it('keeps the last trustworthy state when a later read fails', async () => {
		let shouldFail = false;
		const aggregate = new PullRequestStateAggregate(async (targets) => {
			if (shouldFail) throw new Error('GitHub rate limit exceeded');
			return Object.fromEntries(targets.map((entry) => [entry.workstreamId, 'ready' as const]));
		});

		await aggregate.track([target()]);
		shouldFail = true;
		await aggregate.refreshWorkstream('workstream-a');

		expect(aggregate.stateByWorkstream['workstream-a']).toBe('ready');
		expect(aggregate.lastErrorByWorkstream['workstream-a']).toBe('GitHub rate limit exceeded');
		expect(aggregate.loadingByWorkstream['workstream-a']).toBe(false);
	});

	it('falls back to unknown when a first read fails with nothing known', async () => {
		const aggregate = new PullRequestStateAggregate(async () => {
			throw new Error('network is unreachable');
		});

		await aggregate.track([target()]);

		expect(aggregate.stateByWorkstream['workstream-a']).toBe('unknown');
		expect(aggregate.lastErrorByWorkstream['workstream-a']).toBe('network is unreachable');
	});

	it('keeps the prior state for a workstream the loader silently omits', async () => {
		let answer = true;
		const aggregate = new PullRequestStateAggregate(async (targets) =>
			answer
				? Object.fromEntries(targets.map((entry) => [entry.workstreamId, 'ready' as const]))
				: {},
		);

		await aggregate.track([target()]);
		answer = false;
		await aggregate.refreshWorkstream('workstream-a');

		expect(aggregate.stateByWorkstream['workstream-a']).toBe('ready');
	});

	it('caps how many repository reads run at once', async () => {
		const releases: Array<() => void> = [];
		let inFlight = 0;
		let maxInFlight = 0;
		const load: PullRequestStateLoader = (targets) => {
			inFlight += 1;
			maxInFlight = Math.max(maxInFlight, inFlight);
			return new Promise((resolve) => {
				releases.push(() => {
					inFlight -= 1;
					resolve(
						Object.fromEntries(targets.map((entry) => [entry.workstreamId, 'open' as const])),
					);
				});
			});
		};
		const aggregate = new PullRequestStateAggregate(load);

		const tracked = aggregate.track(
			Array.from({ length: 9 }, (_unused, index) =>
				target({
					workstreamId: `workstream-${index}`,
					repoId: `repo-${index}`,
					head: `feature-${index}`,
				}),
			),
		);

		expect(maxInFlight).toBe(4);
		while (releases.length > 0) {
			releases.shift()?.();
			await flush();
		}
		await tracked;

		expect(maxInFlight).toBe(4);
		expect(Object.values(aggregate.stateByWorkstream)).toEqual(
			Array.from({ length: 9 }, () => 'open'),
		);
	});

	it('coalesces a refresh burst into one read plus one trailing read', async () => {
		const resolvers: Array<(states: Record<string, PullRequestState>) => void> = [];
		const aggregate = new PullRequestStateAggregate(
			() => new Promise((resolve) => resolvers.push(resolve)),
		);

		const initial = aggregate.track([target()]);
		expect(resolvers).toHaveLength(1);

		const one = aggregate.refreshWorkstream('workstream-a');
		const two = aggregate.refreshWorkstream('workstream-a');
		expect(resolvers).toHaveLength(1);

		resolverAt(resolvers, 0)({ 'workstream-a': 'open' });
		await flush();
		expect(resolvers).toHaveLength(2);

		resolverAt(resolvers, 1)({ 'workstream-a': 'ready' });
		await Promise.all([initial, one, two]);

		expect(resolvers).toHaveLength(2);
		expect(aggregate.stateByWorkstream['workstream-a']).toBe('ready');
	});

	it('drops every tracked row and stops polling on reset', async () => {
		const aggregate = new PullRequestStateAggregate(async (targets) =>
			Object.fromEntries(targets.map((entry) => [entry.workstreamId, 'ready' as const])),
		);
		await aggregate.track([target()]);
		aggregate.startPolling();

		aggregate.reset();

		expect(aggregate.stateByWorkstream).toEqual({});
		expect(aggregate.stateFor('workstream-a')).toBe('unknown');
		await aggregate.refreshWorkstream('workstream-a');
		expect(aggregate.stateByWorkstream).toEqual({});
	});
});
