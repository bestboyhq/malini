import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { workstreamSnapshotsHook } from '$shared/repositories/repositories.api';

import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';
import { activateExtensionsHook } from '../hooks/activate-extensions.hook';
import { startExtensionRuntimeCommand } from './start-extension-runtime.command';
import { stopExtensionRuntimeCommand } from './stop-extension-runtime.command';
import { warmExtensionRuntimeCommand } from './warm-extension-runtime.command';
import { warmExtensionWorkstreamCommand } from './warm-extension-workstream.command';

const MOST_RECENT = {
	id: 'fake-workstream-chat',
	path: '/tmp/malini/worktrees/fake-workstream-chat',
	repositoryPath: '/tmp/malini/worktrees/fake-workstream-chat',
	branch: 'malini/fake-workstream-chat',
	baseBranch: 'main',
};

const OTHER = {
	id: 'fake-workstream-files',
	path: '/tmp/malini/worktrees/fake-workstream-files',
	repositoryPath: '/tmp/malini/worktrees/fake-workstream-files',
	branch: 'malini/fake-workstream-files',
	baseBranch: 'main',
};

afterEach(async () => {
	vi.restoreAllMocks();
	stopExtensionRuntimeCommand();
	await vi.waitFor(() => expect(extensionRuntimeStore.isMounted()).toBe(false));
	await new Promise<void>((resolve) => setTimeout(resolve, 20));
	extensionRuntimeStore.requestedWorkstreamFingerprint = null;
	extensionRuntimeStore.requestedInBackground = false;
	workstreamSnapshotsHook().clear();
	setPlatformForTest(null);
	globalThis.localStorage.clear();
});

describe('warming the extension runtime away from a workstream page', () => {
	it('runs the extensions for the most recent workstream while no workstream is open', async () => {
		setPlatformForTest(createFakePlatform());
		startExtensionRuntimeCommand({ knownWorkstreams: () => [MOST_RECENT, OTHER] });

		warmExtensionRuntimeCommand(MOST_RECENT);

		await vi.waitFor(() =>
			expect(extensionRuntimeStore.service?.workstream?.id).toBe(MOST_RECENT.id),
		);
		await vi.waitFor(() => expect(extensionRuntimeStore.ready).toBe(true));
	});

	it('leaves the runtime to a workstream page that already asked for its own workstream', async () => {
		setPlatformForTest(createFakePlatform());
		startExtensionRuntimeCommand({ knownWorkstreams: () => [MOST_RECENT, OTHER] });
		const activate = vi.spyOn(extensionRuntimeStore.coordinator(), 'activate');
		activateExtensionsHook()(openRequest(OTHER));

		warmExtensionRuntimeCommand(MOST_RECENT);
		await vi.waitFor(() => expect(extensionRuntimeStore.service?.workstream?.id).toBe(OTHER.id));

		expect(activate.mock.calls.map(([workstream]) => workstream.id)).toEqual([OTHER.id]);
	});

	it('lets opening the workstream take over a warm-up that is still running', async () => {
		setPlatformForTest(createFakePlatform());
		startExtensionRuntimeCommand({ knownWorkstreams: () => [MOST_RECENT, OTHER] });
		const coordinator = extensionRuntimeStore.coordinator();
		const warmActivation = coordinator.activate.bind(coordinator);
		let releaseWarmActivation!: () => void;
		const warmActivationHeld = new Promise<void>((resolve) => {
			releaseWarmActivation = resolve;
		});
		const activate = vi
			.spyOn(coordinator, 'activate')
			.mockImplementationOnce(async (workstream) => {
				await warmActivationHeld;
				return warmActivation(workstream);
			});

		warmExtensionRuntimeCommand(MOST_RECENT);
		await vi.waitFor(() => expect(activate).toHaveBeenCalledTimes(1));
		activateExtensionsHook()(openRequest(MOST_RECENT));
		releaseWarmActivation();

		await vi.waitFor(() => expect(activate).toHaveBeenCalledTimes(2));
		await vi.waitFor(() => expect(extensionRuntimeStore.ready).toBe(true));
	});

	it('hands a warm-up whose extensions failed to the real open, which retries them', async () => {
		setPlatformForTest(createFakePlatform());
		startExtensionRuntimeCommand({ knownWorkstreams: () => [MOST_RECENT, OTHER] });
		const coordinator = extensionRuntimeStore.coordinator();
		const activate = vi.spyOn(coordinator, 'activate').mockResolvedValueOnce({
			activated: [],
			failed: [{ id: 'malini.repository', error: new Error('repository did not start') }],
			skipped: [],
		});

		warmExtensionRuntimeCommand(MOST_RECENT);
		await vi.waitFor(() => expect(extensionRuntimeStore.requestedWorkstreamFingerprint).toBeNull());
		expect(extensionRuntimeStore.ready).toBe(false);

		activateExtensionsHook()(openRequest(MOST_RECENT));

		await vi.waitFor(() => expect(activate).toHaveBeenCalledTimes(2));
	});

	it('reads a hovered workstream ahead of its first visit once the runtime is running', async () => {
		const fake = createFakePlatform();
		setPlatformForTest(fake);
		let known = [MOST_RECENT];
		startExtensionRuntimeCommand({ knownWorkstreams: () => known });
		await extensionRuntimeStore.coordinator().activate(MOST_RECENT);
		await new Promise<void>((resolve) => setTimeout(resolve, 20));
		known = [MOST_RECENT, OTHER];

		warmExtensionWorkstreamCommand(OTHER);

		await vi.waitFor(() =>
			expect(
				fake.calls.some(
					({ command, args }) =>
						command === 'extensions.list-workstream-files' &&
						typeof args === 'object' &&
						args !== null &&
						'workstreamId' in args &&
						args.workstreamId === OTHER.id,
				),
			).toBe(true),
		);
		expect(extensionRuntimeStore.service?.workstream?.id).toBe(MOST_RECENT.id);
	});
});

function openRequest(
	workstream: typeof MOST_RECENT,
): Parameters<ReturnType<typeof activateExtensionsHook>>[0] {
	return {
		workstream,
		currentWorkstreamId: () => workstream.id,
		creationContext: null,
		onCreationAnnounced: () => undefined,
	};
}
