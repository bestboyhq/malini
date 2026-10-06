import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	ACTIVE_WORKSTREAM_PULL_REQUEST_REFRESH_INTERVAL_MS,
	ACTIVE_WORKSTREAM_TOTALS_REFRESH_INTERVAL_MS,
	type ActiveWorkstreamFreshnessCallbacks,
	type ActiveWorkstreamFreshnessOptions,
	type PullRequestActivity,
} from '$shared/repositories/domain/workstream-freshness';
import { ActiveWorkstreamFreshnessStore } from './active-workstream-freshness.store.svelte';

afterEach(() => {
	vi.useRealTimers();
});

describe('ActiveWorkstreamFreshnessStore', () => {
	it('refreshes local state on its cadence and a running pull request every interval', async () => {
		vi.useFakeTimers();
		const harness = createHarness();
		harness.freshness.setWorkstream('workstream-a');
		harness.freshness.start();
		await settle();

		expect(harness.calls()).toEqual([
			'totals:workstream-a',
			'local:workstream-a',
			'pull-request:workstream-a',
		]);
		harness.clear();

		await vi.advanceTimersByTimeAsync(ACTIVE_WORKSTREAM_PULL_REQUEST_REFRESH_INTERVAL_MS);
		expect(harness.calls()).toEqual(['pull-request:workstream-a']);
		harness.clear();

		await vi.advanceTimersByTimeAsync(
			ACTIVE_WORKSTREAM_TOTALS_REFRESH_INTERVAL_MS -
				ACTIVE_WORKSTREAM_PULL_REQUEST_REFRESH_INTERVAL_MS,
		);
		expect(harness.calls()).toEqual(['totals:workstream-a', 'local:workstream-a']);
		harness.freshness.stop();
	});

	it('backs off while the pull request is idle and stops reading a finished one', async () => {
		vi.useFakeTimers();
		const harness = createHarness();
		harness.setActivity('idle');
		harness.freshness.setWorkstream('workstream-a');
		harness.freshness.start();
		await settle();

		const pullRequestReadsAt = await pullRequestReadSeconds(harness, 180);
		expect(pullRequestReadsAt).toEqual([0, 20, 60, 120, 180]);

		harness.setActivity('running');
		expect(await pullRequestReadSeconds(harness, 30)).toEqual([10, 20, 30]);

		harness.setActivity('finished');
		expect(await pullRequestReadSeconds(harness, 600)).toEqual([]);
		harness.freshness.stop();
	});

	it('keeps one pull request cadence however often the workstream changes', async () => {
		vi.useFakeTimers();
		const harness = createHarness();
		harness.freshness.start();
		for (const workstreamId of ['workstream-a', 'workstream-b', 'workstream-a', 'workstream-b']) {
			harness.freshness.setWorkstream(workstreamId);
			await settle();
		}
		harness.clear();

		await vi.advanceTimersByTimeAsync(ACTIVE_WORKSTREAM_PULL_REQUEST_REFRESH_INTERVAL_MS);

		expect(harness.calls()).toEqual(['pull-request:workstream-b']);
		harness.freshness.stop();
	});

	it('pauses while hidden or unfocused and performs one merged refresh on return', async () => {
		vi.useFakeTimers();
		const harness = createHarness(false);
		harness.freshness.setWorkstream('workstream-a');
		harness.freshness.start();

		await vi.advanceTimersByTimeAsync(ACTIVE_WORKSTREAM_PULL_REQUEST_REFRESH_INTERVAL_MS);
		expect(harness.calls()).toEqual([]);

		harness.setForeground(true);
		harness.foregroundListener();
		harness.foregroundListener();
		await settle();
		expect(harness.calls()).toEqual([
			'totals:workstream-a',
			'local:workstream-a',
			'pull-request:workstream-a',
		]);
		harness.freshness.stop();
	});

	it('coalesces an overlapping burst into one in-flight and one trailing pass', async () => {
		vi.useFakeTimers();
		let releaseFirst: () => void = () => undefined;
		let totalsCalls = 0;
		const freshness = freshnessWith(
			{
				refreshTotals: async () => {
					totalsCalls += 1;
					if (totalsCalls === 1) await new Promise<void>((resolve) => (releaseFirst = resolve));
				},
				refreshLocalRepository: () => undefined,
				refreshPullRequest: () => undefined,
			},
			foregroundOptions(),
		);
		freshness.setWorkstream('workstream-a');
		freshness.start();
		await settle();

		const one = freshness.refreshNow({ totals: true });
		const two = freshness.refreshNow({ totals: true });
		const three = freshness.refreshNow({ totals: true });
		releaseFirst();
		await Promise.all([one, two, three]);

		expect(totalsCalls).toBe(2);
		freshness.stop();
	});

	it('starts the next workstream immediately while the previous generation remains in flight', async () => {
		vi.useFakeTimers();
		const releaseFirstWorkstream = deferred<void>();
		const calls: string[] = [];
		const freshness = freshnessWith(
			{
				ensureTotals: async (workstreamId) => {
					calls.push(`ensure:${workstreamId}`);
					if (workstreamId === 'workstream-a') await releaseFirstWorkstream.promise;
				},
				refreshTotals: (workstreamId) => {
					calls.push(`totals:${workstreamId}`);
				},
				refreshLocalRepository: (workstreamId) => {
					calls.push(`local:${workstreamId}`);
				},
				refreshPullRequest: (workstreamId) => {
					calls.push(`pull-request:${workstreamId}`);
				},
			},
			{
				...foregroundOptions(),
				totalsIntervalMs: 100,
				pullRequestIntervalMs: 200,
			},
		);
		freshness.setWorkstream('workstream-a');
		freshness.start();
		await settle();
		expect(calls).toEqual([
			'ensure:workstream-a',
			'local:workstream-a',
			'pull-request:workstream-a',
		]);

		freshness.setWorkstream('workstream-b');
		const secondWorkstreamIdle = freshness.refreshNow({ localRepository: true });
		await secondWorkstreamIdle;
		expect(calls).toContain('ensure:workstream-b');
		expect(calls).toContain('local:workstream-b');
		expect(calls).toContain('pull-request:workstream-b');

		calls.length = 0;
		await vi.advanceTimersByTimeAsync(100);
		expect(calls).toEqual(['totals:workstream-b', 'local:workstream-b']);

		calls.length = 0;
		releaseFirstWorkstream.resolve();
		await settle();
		expect(calls).toEqual([]);
		await vi.advanceTimersByTimeAsync(100);
		expect(calls).toEqual([
			'pull-request:workstream-b',
			'totals:workstream-b',
			'local:workstream-b',
		]);
		freshness.stop();
	});

	it('retires scheduled work for the previous workstream and after stop', async () => {
		vi.useFakeTimers();
		const harness = createHarness();
		harness.freshness.setWorkstream('workstream-a');
		harness.freshness.start();
		await settle();
		harness.clear();

		harness.freshness.setWorkstream('workstream-b');
		await settle();
		expect(harness.calls().every((call) => call.endsWith(':workstream-b'))).toBe(true);
		harness.clear();

		harness.freshness.stop();
		await vi.advanceTimersByTimeAsync(ACTIVE_WORKSTREAM_PULL_REQUEST_REFRESH_INTERVAL_MS * 2);
		expect(harness.calls()).toEqual([]);
	});
});

function createHarness(initialForeground = true) {
	let foreground = initialForeground;
	let activity: PullRequestActivity = 'running';
	let listener: () => void = () => undefined;
	const calls: string[] = [];
	const freshness = freshnessWith(
		{
			pullRequestActivity: () => activity,
			refreshTotals: (workstreamId) => {
				calls.push(`totals:${workstreamId}`);
			},
			refreshLocalRepository: (workstreamId) => {
				calls.push(`local:${workstreamId}`);
			},
			refreshPullRequest: (workstreamId) => {
				calls.push(`pull-request:${workstreamId}`);
			},
		},
		{
			isForeground: () => foreground,
			subscribeForeground: (nextListener) => {
				listener = nextListener;
				return () => {
					listener = () => undefined;
				};
			},
		},
	);
	return {
		freshness,
		calls: () => [...calls],
		clear: () => calls.splice(0),
		setForeground: (value: boolean) => {
			foreground = value;
		},
		setActivity: (value: PullRequestActivity) => {
			activity = value;
		},
		foregroundListener: () => listener(),
	};
}

function foregroundOptions() {
	return {
		isForeground: () => true,
		subscribeForeground: () => () => undefined,
	};
}

async function pullRequestReadSeconds(
	harness: ReturnType<typeof createHarness>,
	seconds: number,
): Promise<number[]> {
	const readAt: number[] = [];
	for (let second = 0; second <= seconds; second += 1) {
		if (second > 0) await vi.advanceTimersByTimeAsync(1_000);
		if (harness.calls().some((call) => call.startsWith('pull-request:'))) readAt.push(second);
		harness.clear();
	}
	return readAt;
}

async function settle(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((next, fail) => {
		resolve = next;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function freshnessWith(
	callbacks: ActiveWorkstreamFreshnessCallbacks,
	options: ActiveWorkstreamFreshnessOptions,
) {
	const store = new ActiveWorkstreamFreshnessStore(options);
	return {
		setWorkstream: (workstreamId: string | null) => store.setWorkstream(workstreamId),
		start: () => store.start(callbacks),
		refreshNow: (request: Parameters<ActiveWorkstreamFreshnessStore['refreshNow']>[0]) =>
			store.refreshNow(request),
		stop: () => store.stop(),
	};
}
