import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openRunsStore } from '$lib/chat/infrastructure/stores/open-runs.store.svelte';
import { mountOpenRunGuard } from './open-run-guard-harness.svelte';
import { setPlatformForTest } from '$shared/port/platform';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';

const WORKSTREAM = 'ws-guarded';
const OTHER_WORKSTREAM = 'ws-idle';

function platformWithOpenRun(): FakePlatform {
	const platform = createFakePlatform({
		agentSessions: [
			{
				id: 'session-open',
				workstreamId: WORKSTREAM,
				currentRunId: 'run-1',
			},
		],
	});
	setPlatformForTest(platform);
	return platform;
}

function openRunChecks(platform: FakePlatform): readonly unknown[] {
	return platform.calls
		.filter(({ command }) => command === 'chat.workstream-has-open-run')
		.map(({ args }) => args);
}

afterEach(() => {
	setPlatformForTest(null);
	openRunsStore.openByWorkstream = {};
});

describe('the workstream open-run guard', () => {
	it('reads the workstream as blocked while a run is open', async () => {
		platformWithOpenRun();
		const guard = mountOpenRunGuard(WORKSTREAM);
		flushSync();

		await vi.waitFor(() => expect(guard.inFlight).toBe(true));

		guard.stop();
	});

	it('asks again on the next run transition, and releases when the run ends', async () => {
		const platform = platformWithOpenRun();
		const guard = mountOpenRunGuard(WORKSTREAM);
		flushSync();
		await vi.waitFor(() => expect(guard.inFlight).toBe(true));

		await platform.invoke('chat.reset-workstream-runs', { workstreamId: WORKSTREAM });
		guard.revalidate();
		flushSync();

		await vi.waitFor(() => expect(guard.inFlight).toBe(false));

		guard.stop();
	});

	it('answers for the workstream it is pointed at, not the one it started on', async () => {
		const platform = platformWithOpenRun();
		const guard = mountOpenRunGuard(WORKSTREAM);
		flushSync();
		await vi.waitFor(() => expect(guard.inFlight).toBe(true));

		guard.workstreamId = OTHER_WORKSTREAM;
		flushSync();

		await vi.waitFor(() => expect(guard.inFlight).toBe(false));
		expect(openRunChecks(platform)).toEqual([
			{ workstreamId: WORKSTREAM },
			{ workstreamId: OTHER_WORKSTREAM },
		]);

		guard.stop();
	});

	it('leaves undo reachable when the guard itself cannot be read', async () => {
		const platform = platformWithOpenRun();
		const guard = mountOpenRunGuard(WORKSTREAM);
		flushSync();
		await vi.waitFor(() => expect(guard.inFlight).toBe(true));

		platform.define('chat.workstream-has-open-run', async () => {
			throw new Error('control plane is not up');
		});
		guard.revalidate();
		flushSync();

		await vi.waitFor(() => expect(guard.inFlight).toBe(false));
		expect(openRunChecks(platform)).toEqual([
			{ workstreamId: WORKSTREAM },
			{ workstreamId: WORKSTREAM },
		]);

		guard.stop();
	});
});
