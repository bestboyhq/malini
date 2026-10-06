import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import {
	refreshRepositoriesCommand,
	refreshWorkstreamsCommand,
	workstreamSnapshotsHook,
} from '$shared/repositories/repositories.api';

import { knownExtensionWorkstreamsQuery } from '../application/queries/known-extension-workstreams.query.svelte';
import { bundledExtensions } from '../infrastructure/runtime/bundled-extensions';
import { extensionRuntimeStore } from '../infrastructure/stores/extension-runtime.store.svelte';
import ExtensionRuntimeHost from './ExtensionRuntimeHost.svelte';

afterEach(async () => {
	await vi.waitFor(() => expect(extensionRuntimeStore.isMounted()).toBe(false));
	await new Promise<void>((resolve) => setTimeout(resolve, 20));
	extensionRuntimeStore.requestedWorkstreamFingerprint = null;
	extensionRuntimeStore.requestedInBackground = false;
	workstreamSnapshotsHook().clear();
	setPlatformForTest(null);
	globalThis.localStorage.clear();
});

describe('ExtensionRuntimeHost', () => {
	it('keeps offering the current workstreams after the host that started the runtime is gone', async () => {
		const fake = createFakePlatform();
		setPlatformForTest(fake);
		refreshWorkstreamsCommand();
		refreshRepositoriesCommand();
		await vi.waitFor(() => expect(knownIds()).toContain('fake-workstream-chat'));
		const first = render();
		const second = render();
		await first.stop();

		fake.seed({
			workstreams: [
				{
					id: 'fake-workstream-new',
					projectId: 'fake-project-malini',
					name: 'New',
					path: '/tmp/malini/worktrees/fake-workstream-new',
					branch: 'malini/fake-workstream-new',
					baseBranch: 'main',
					status: 'active',
				},
			],
		});
		refreshWorkstreamsCommand();
		await vi.waitFor(() => expect(knownIds()).toEqual(['fake-workstream-new']));

		await vi.waitFor(async () =>
			expect((await runtimeWorkstreams()).map(({ id }) => id)).toEqual(['fake-workstream-new']),
		);
		await second.stop();
	});
});

function render(): Readonly<{ stop: () => Promise<void> }> {
	const target = document.createElement('div');
	document.body.append(target);
	const app = mount(ExtensionRuntimeHost, { target, props: {} });
	flushSync();
	return {
		stop: async () => {
			await unmount(app);
			target.remove();
		},
	};
}

function knownIds(): string[] {
	return knownExtensionWorkstreamsQuery.data.map(({ id }) => id);
}

async function runtimeWorkstreams(): Promise<readonly { id: string }[]> {
	const service = extensionRuntimeStore.service;
	const manifest = bundledExtensions[0]?.manifest;
	if (!service || !manifest) return [];
	const api = service.host.createAPI(manifest, { track: (disposable) => disposable });
	return (await api.workstream.list?.()) ?? [];
}
