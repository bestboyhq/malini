import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { workstreamSnapshotsHook } from '$shared/repositories/repositories.api';

import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';
import { startExtensionRuntimeCommand } from '../commands/start-extension-runtime.command';
import { stopExtensionRuntimeCommand } from '../commands/stop-extension-runtime.command';
import { activateExtensionsHook } from '../hooks/activate-extensions.hook';
import { observeActivation } from './fixtures/activation-observer.svelte';

const WORKSTREAM = {
	id: 'fake-workstream-chat',
	path: '/tmp/malini/worktrees/fake-workstream-chat',
	repositoryPath: '/tmp/malini/worktrees/fake-workstream-chat',
	branch: 'malini/fake-workstream-chat',
	baseBranch: 'main',
};

afterEach(async () => {
	stopExtensionRuntimeCommand();
	await vi.waitFor(() => expect(extensionRuntimeStore.isMounted()).toBe(false));
	await new Promise<void>((resolve) => setTimeout(resolve, 20));
	extensionRuntimeStore.requestedWorkstreamFingerprint = null;
	extensionRuntimeStore.requestedInBackground = false;
	workstreamSnapshotsHook().clear();
	setPlatformForTest(null);
	globalThis.localStorage.clear();
});

describe('the workstream the extensions run for', () => {
	it('is announced to readers once an activation commits, with a new generation', async () => {
		setPlatformForTest(createFakePlatform());
		startExtensionRuntimeCommand();
		const observer = observeActivation();
		flushSync();
		const generationBefore = observer.generations.at(-1) ?? 0;

		activateExtensionsHook()({
			workstream: WORKSTREAM,
			currentWorkstreamId: () => WORKSTREAM.id,
			creationContext: null,
			onCreationAnnounced: () => undefined,
		});
		await vi.waitFor(() => expect(extensionRuntimeStore.ready).toBe(true));
		flushSync();

		expect(observer.workstreamIds).toEqual([null, WORKSTREAM.id]);
		expect(observer.generations.at(-1)).toBeGreaterThan(generationBefore);
		observer.stop();
	});
});
