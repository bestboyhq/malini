import { beforeEach, describe, expect, it } from 'vitest';

import {
	PERFORMANCE_BUDGETS,
	RuntimeDiagnostics,
} from '$shared/performance/runtime-diagnostics.svelte';

import {
	FOREGROUND_ACTIVITY,
	ForegroundActivityChannel,
	foregroundActivity,
} from './foreground-activity.svelte';

describe('the foreground activity channel', () => {
	beforeEach(() => {
		foregroundActivity.reset();
	});

	it('stays silent while a background repository span is measured', async () => {
		const diagnostics = new RuntimeDiagnostics();
		const channel = new ForegroundActivityChannel();
		let announcedDuringSpan: string | null = 'not-read';

		await diagnostics.measure(
			{
				category: 'repository',
				label: 'Checking pull request',
				budgetMs: PERFORMANCE_BUDGETS.repositoryReadMs,
				target: 'workstream-one',
			},
			async () => {
				announcedDuringSpan = channel.current?.message ?? null;
			},
		);

		expect(announcedDuringSpan).toBeNull();
		expect(channel.current).toBeNull();
		expect(diagnostics.recent).toHaveLength(1);
	});

	it('announces work the user started, for exactly as long as it runs', async () => {
		const channel = new ForegroundActivityChannel();
		let announcedDuringOperation: string | null = null;

		await channel.track(FOREGROUND_ACTIVITY.startingAgent, async () => {
			announcedDuringOperation = channel.current?.message ?? null;
		});

		expect(announcedDuringOperation).toBe('Starting the agent');
		expect(channel.current).toBeNull();
	});

	it('clears the announcement when the operation fails', async () => {
		const channel = new ForegroundActivityChannel();

		await expect(
			channel.track(FOREGROUND_ACTIVITY.startingAgent, async () => {
				throw new Error('bridge refused the session');
			}),
		).rejects.toThrow('bridge refused the session');

		expect(channel.current).toBeNull();
	});

	it('falls back to the operation still running when a newer one ends first', () => {
		const channel = new ForegroundActivityChannel();
		const first = channel.begin(FOREGROUND_ACTIVITY.startingAgent);
		const second = channel.begin(FOREGROUND_ACTIVITY.startingAgent);

		expect(channel.current?.id).toBe(second.id);
		second.end();
		expect(channel.current?.id).toBe(first.id);
		first.end();
		expect(channel.current).toBeNull();
	});

	it('ignores a handle that is ended twice', () => {
		const channel = new ForegroundActivityChannel();
		const outer = channel.begin(FOREGROUND_ACTIVITY.startingAgent);
		const inner = channel.begin(FOREGROUND_ACTIVITY.startingAgent);

		inner.end();
		inner.end();
		expect(channel.current?.id).toBe(outer.id);
	});
});
