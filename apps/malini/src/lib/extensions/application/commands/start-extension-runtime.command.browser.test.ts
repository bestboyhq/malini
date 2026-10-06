import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { workstreamSnapshotsHook } from '$shared/repositories/repositories.api';

import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';
import { startExtensionRuntimeCommand } from './start-extension-runtime.command';
import { stopExtensionRuntimeCommand } from './stop-extension-runtime.command';

const TARGET = { workstreamId: 'workstream-1', baseBranch: 'main' };

const WORKSTREAM = {
	id: 'fake-workstream-chat',
	path: '/tmp/malini/worktrees/fake-workstream-chat',
	repositoryPath: '/Users/dev/work/malini',
	branch: 'malini/fake-workstream-chat',
	baseBranch: 'main',
};

afterEach(async () => {
	stopExtensionRuntimeCommand();
	await vi.waitFor(() => expect(extensionRuntimeStore.isMounted()).toBe(false));
	workstreamSnapshotsHook().clear();
	setPlatformForTest(null);
	globalThis.localStorage.clear();
});

describe('startExtensionRuntimeCommand', () => {
	it('shares the repositories snapshot cache and clears it when the runtime stops', async () => {
		const fake = createFakePlatform();
		const snapshot = vi.fn(async () => ({
			patch: '',
			totals: { additions: 1, deletions: 0, files: 1 },
		}));
		fake.define('repositories.workstream-snapshot', snapshot);
		setPlatformForTest(fake);
		const shared = workstreamSnapshotsHook();

		startExtensionRuntimeCommand();
		await shared.get(TARGET);
		await shared.get(TARGET);
		expect(snapshot).toHaveBeenCalledOnce();

		stopExtensionRuntimeCommand();
		await vi.waitFor(async () => {
			await shared.get(TARGET);
			expect(snapshot).toHaveBeenCalledTimes(2);
		});
	});

	it('keeps running while a remounted host still holds it', async () => {
		setPlatformForTest(createFakePlatform());

		startExtensionRuntimeCommand();
		startExtensionRuntimeCommand();
		stopExtensionRuntimeCommand();
		await new Promise<void>((resolve) => setTimeout(resolve, 10));

		expect(extensionRuntimeStore.isMounted()).toBe(true);
		expect(extensionRuntimeStore.service).not.toBeNull();
		await expect(extensionRuntimeStore.coordinator().activate(WORKSTREAM)).resolves.toBeDefined();

		stopExtensionRuntimeCommand();
		await vi.waitFor(() => expect(extensionRuntimeStore.isMounted()).toBe(false));
	});

	it('reloads routines for the active workstream when they change, until stopped', async () => {
		const fake = createFakePlatform();
		setPlatformForTest(fake);
		const routineReads = (): number =>
			fake.calls.filter(({ command }) => command === 'routines.list').length;

		startExtensionRuntimeCommand();
		await extensionRuntimeStore.coordinator().activate(WORKSTREAM);
		const afterActivation = routineReads();
		fake.emit('routines:changed', {});
		await vi.waitFor(() => expect(routineReads()).toBe(afterActivation + 1));

		stopExtensionRuntimeCommand();
		await vi.waitFor(() => expect(fake.listenerCount('routines:changed')).toBe(0));
		expect(fake.listenerCount('routines:gated-run-changed')).toBe(0);
	});
});
