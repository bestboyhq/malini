import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import type { WorkstreamSnapshotReader } from '$shared/repositories/repositories.api';

import { ExtensionRuntimeCoordinator } from './extension-runtime-coordinator';

afterEach(() => {
	setPlatformForTest(null);
	globalThis.localStorage.clear();
});

function snapshotReader(): WorkstreamSnapshotReader {
	return {
		get: vi.fn(async () => ({ patch: '', totals: { additions: 0, deletions: 0, files: 1 } })),
		invalidate: vi.fn(() => 0),
		invalidateWorkstream: vi.fn(),
		clear: vi.fn(),
	};
}

describe('ExtensionRuntimeCoordinator', () => {
	it('clears the shared workstream snapshot cache it was started with when it stops', async () => {
		setPlatformForTest(createFakePlatform());
		const workstreamSnapshots = snapshotReader();
		const coordinator = new ExtensionRuntimeCoordinator();
		coordinator.initialize({ workstreamSnapshots });

		expect(workstreamSnapshots.clear).not.toHaveBeenCalled();
		await coordinator.stop();

		expect(workstreamSnapshots.clear).toHaveBeenCalledOnce();
		expect(coordinator.service).toBeNull();
	});
});
