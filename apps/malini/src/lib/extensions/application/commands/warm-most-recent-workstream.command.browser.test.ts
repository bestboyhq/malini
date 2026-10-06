import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { workstreamSnapshotsHook } from '$shared/repositories/repositories.api';

import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';
import { knownExtensionWorkstreamsQuery } from '../queries/known-extension-workstreams.query.svelte';
import { startExtensionRuntimeCommand } from './start-extension-runtime.command';
import { stopExtensionRuntimeCommand } from './stop-extension-runtime.command';
import { warmMostRecentWorkstreamCommand } from './warm-most-recent-workstream.command';

afterEach(async () => {
	stopExtensionRuntimeCommand();
	await vi.waitFor(() => expect(extensionRuntimeStore.isMounted()).toBe(false));
	await new Promise<void>((resolve) => setTimeout(resolve, 20));
	workstreamSnapshotsHook().clear();
	workstreamsAggregate.reset();
	repositoriesAggregate.reset();
	setPlatformForTest(null);
	globalThis.localStorage.clear();
});

describe('warming the most recent workstream after the first paint', () => {
	it('loads the workstreams it needs, then runs the extensions for the most recent one', async () => {
		setPlatformForTest(createFakePlatform());
		startExtensionRuntimeCommand({ knownWorkstreams: knownExtensionWorkstreamsQuery.read });

		await warmMostRecentWorkstreamCommand(() => '');

		const mostRecent = knownExtensionWorkstreamsQuery.data[0];
		expect(mostRecent).toBeDefined();
		await vi.waitFor(() =>
			expect(extensionRuntimeStore.service?.workstream?.id).toBe(mostRecent?.id),
		);
	});

	it('leaves the extensions to the workstream page when a workstream is open', async () => {
		setPlatformForTest(createFakePlatform());
		startExtensionRuntimeCommand({ knownWorkstreams: knownExtensionWorkstreamsQuery.read });

		await warmMostRecentWorkstreamCommand(() => 'fake-workstream-files');
		await new Promise<void>((resolve) => setTimeout(resolve, 200));

		expect(extensionRuntimeStore.service?.workstream ?? null).toBeNull();
		expect(extensionRuntimeStore.requestedWorkstreamFingerprint).toBeNull();
	});
});
