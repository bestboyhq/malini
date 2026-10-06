import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { syncWorkstreamsHook } from './sync-workstreams.hook';
import { watchWorkstreamFilesChangedHook } from './watch-workstream-files-changed.hook';

let platform: FakePlatform;

beforeEach(() => {
	platform = createFakePlatform({ projects: [], workstreams: [] });
	setPlatformForTest(platform);
	workstreamsAggregate.reset();
});

afterEach(() => {
	setPlatformForTest(null);
	workstreamsAggregate.reset();
	vi.restoreAllMocks();
});

function listCalls(): number {
	return platform.calls.filter(({ command }) => command === 'repositories.list-workstreams').length;
}

describe('keeping the workstream list in sync', () => {
	it('reloads the list when the platform creates or removes a workstream, until released', async () => {
		const release = syncWorkstreamsHook();

		platform.emit('repositories:workstream-created', { workstreamId: 'ws-a' });
		await vi.waitFor(() => expect(listCalls()).toBe(1));
		platform.emit('repositories:workstream-removed', { workstreamId: 'ws-a', deleted: true });
		await vi.waitFor(() => expect(listCalls()).toBe(2));

		release();
		platform.emit('repositories:workstream-created', { workstreamId: 'ws-b' });
		await Promise.resolve();
		expect(listCalls()).toBe(2);
		expect(platform.listenerCount('repositories:workstream-created')).toBe(0);
	});

	it('watches file changes only while held', () => {
		const release = watchWorkstreamFilesChangedHook();
		expect(platform.listenerCount('repositories:workstream-files-changed')).toBe(1);

		release();

		expect(platform.listenerCount('repositories:workstream-files-changed')).toBe(0);
	});
});
