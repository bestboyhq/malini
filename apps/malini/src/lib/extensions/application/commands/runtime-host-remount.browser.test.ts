import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from '$hyper-ui/components/toast';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { workstreamSnapshotsHook } from '$shared/repositories/repositories.api';

import { ExtensionRuntimeCoordinator } from '../../infrastructure/runtime/extension-runtime-coordinator';
import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';
import { activateExtensionsHook } from '../hooks/activate-extensions.hook';
import { observePanels } from '../queries/fixtures/panels-observer.svelte';
import { extensionWorkstreamQuery } from '../queries/extension-workstream.query.svelte';
import { announceWorkstreamLifecycleCommand } from './announce-workstream-lifecycle.command';
import { startExtensionRuntimeCommand } from './start-extension-runtime.command';
import { stopExtensionRuntimeCommand } from './stop-extension-runtime.command';
import { warmExtensionRuntimeCommand } from './warm-extension-runtime.command';

const WORKSTREAM = {
	id: 'fake-workstream-chat',
	path: '/tmp/malini/worktrees/fake-workstream-chat',
	repositoryPath: '/tmp/malini/worktrees/fake-workstream-chat',
	branch: 'malini/fake-workstream-chat',
	baseBranch: 'main',
};

afterEach(async () => {
	vi.restoreAllMocks();
	while (extensionRuntimeStore.isHosted()) stopExtensionRuntimeCommand();
	await vi.waitFor(() => expect(extensionRuntimeStore.isMounted()).toBe(false));
	await new Promise<void>((resolve) => setTimeout(resolve, 20));
	extensionRuntimeStore.requestedWorkstreamFingerprint = null;
	extensionRuntimeStore.requestedInBackground = false;
	workstreamSnapshotsHook().clear();
	setPlatformForTest(null);
	globalThis.localStorage.clear();
});

describe('the extension runtime across host remounts', () => {
	it('tells extensions about an archive announced while no host runs them, once a host starts, without a warning', async () => {
		setPlatformForTest(createFakePlatform());
		const archived = vi.spyOn(ExtensionRuntimeCoordinator.prototype, 'announceWorkstreamArchived');
		const warning = vi.spyOn(toast, 'warning');

		announceWorkstreamLifecycleCommand('archived', WORKSTREAM.id);
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		startExtensionRuntimeCommand({ knownWorkstreams: () => [WORKSTREAM] });

		await vi.waitFor(() => expect(archived).toHaveBeenCalledWith(WORKSTREAM.id));
		expect(warning).not.toHaveBeenCalled();
	});

	it('keeps the open workstream when its host is destroyed and mounted again in one go', async () => {
		setPlatformForTest(createFakePlatform());
		startExtensionRuntimeCommand({ knownWorkstreams: () => [WORKSTREAM] });
		open();
		await vi.waitFor(() => expect(extensionWorkstreamQuery.data?.id).toBe(WORKSTREAM.id));

		stopExtensionRuntimeCommand();
		startExtensionRuntimeCommand({ knownWorkstreams: () => [WORKSTREAM] });
		open();
		await new Promise<void>((resolve) => setTimeout(resolve, 20));

		expect(extensionRuntimeStore.isMounted()).toBe(true);
		expect(extensionWorkstreamQuery.data?.id).toBe(WORKSTREAM.id);
		expect(extensionRuntimeStore.ready).toBe(true);
	});

	it('shows the panels of a runtime started again after the previous one stopped', async () => {
		setPlatformForTest(createFakePlatform());
		const observer = observePanels();
		startExtensionRuntimeCommand({ knownWorkstreams: () => [WORKSTREAM] });
		open();
		await vi.waitFor(() => {
			flushSync();
			expect(observer.panelIds().length).toBeGreaterThan(0);
		});

		stopExtensionRuntimeCommand();
		await vi.waitFor(() => expect(extensionRuntimeStore.isMounted()).toBe(false));
		await new Promise<void>((resolve) => setTimeout(resolve, 20));
		flushSync();
		expect(observer.panelIds()).toEqual([]);
		startExtensionRuntimeCommand({ knownWorkstreams: () => [WORKSTREAM] });
		open();

		await vi.waitFor(() => {
			flushSync();
			expect(observer.panelIds().length).toBeGreaterThan(0);
		});
		observer.stop();
	});

	it('warms a workstream in the background again after the runtime stopped and started', async () => {
		setPlatformForTest(createFakePlatform());
		startExtensionRuntimeCommand({ knownWorkstreams: () => [WORKSTREAM] });
		warmExtensionRuntimeCommand(WORKSTREAM);
		await vi.waitFor(() => expect(extensionRuntimeStore.ready).toBe(true));
		stopExtensionRuntimeCommand();
		await vi.waitFor(() => expect(extensionRuntimeStore.isMounted()).toBe(false));

		startExtensionRuntimeCommand({ knownWorkstreams: () => [WORKSTREAM] });
		warmExtensionRuntimeCommand(WORKSTREAM);

		await vi.waitFor(() =>
			expect(extensionRuntimeStore.service?.workstream?.id).toBe(WORKSTREAM.id),
		);
		await vi.waitFor(() => expect(extensionRuntimeStore.ready).toBe(true));
	});

	it('never activates a stopped runtime from a warm-up still waiting for the paint', async () => {
		setPlatformForTest(createFakePlatform());
		const activate = vi.spyOn(ExtensionRuntimeCoordinator.prototype, 'activate');
		startExtensionRuntimeCommand({ knownWorkstreams: () => [WORKSTREAM] });

		warmExtensionRuntimeCommand(WORKSTREAM);
		stopExtensionRuntimeCommand();
		await vi.waitFor(() => expect(extensionRuntimeStore.isMounted()).toBe(false));
		await new Promise<void>((resolve) => setTimeout(resolve, 200));

		expect(activate).not.toHaveBeenCalled();
	});
});

function open(): void {
	activateExtensionsHook()({
		workstream: WORKSTREAM,
		currentWorkstreamId: () => WORKSTREAM.id,
		creationContext: null,
		onCreationAnnounced: () => undefined,
	});
}
