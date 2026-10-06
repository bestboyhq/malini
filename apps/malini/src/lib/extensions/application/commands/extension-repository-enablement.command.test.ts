import type { ExtensionActivationReport, ExtensionWorkstream } from '@malini/extension-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectorPanelCommands } from '$shared/extensions/panel-requests.store.svelte';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';

import { extensionRepositoryEnablementQuery } from '../queries/extension-repository-enablement.query.svelte';
import { enableExtensionForRepositoryCommand } from './enable-extension-for-repository.command';
import { retryExtensionStartCommand } from './retry-extension-start.command';

const runtime = vi.hoisted(() => ({
	reload: async (_workstream: ExtensionWorkstream): Promise<ExtensionActivationReport> => ({
		activated: [],
		failed: [],
		skipped: [],
	}),
}));

vi.mock('../../infrastructure/stores/extension-runtime.store.svelte', () => ({
	extensionRuntimeStore: {
		coordinator: () => ({
			reloadWorkstreamConfiguration: (workstream: ExtensionWorkstream) =>
				runtime.reload(workstream),
		}),
	},
}));

const workstream: ExtensionWorkstream = {
	id: 'fake-workstream-chat',
	path: '/worktrees/chat',
	repositoryPath: '/repositories/malini',
	branch: 'feature/chat',
	baseBranch: 'main',
};

afterEach(() => {
	inspectorPanelCommands.reset();
	setPlatformForTest(null);
});

function installFake(): FakePlatform {
	const fake = createFakePlatform();
	setPlatformForTest(fake);
	return fake;
}

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

function input(extensionId: string): Parameters<typeof enableExtensionForRepositoryCommand>[0] {
	return { workstreamId: workstream.id, workstream, extensionId, panelId: `${extensionId}.panel` };
}

describe('enableExtensionForRepositoryCommand', () => {
	it('enables the extension in the repository, restarts it, and opens its panel', async () => {
		const fake = installFake();
		const reload = vi.spyOn(runtime, 'reload');

		enableExtensionForRepositoryCommand(input('example.linear'));
		expect(extensionRepositoryEnablementQuery.data(workstream.id, 'example.linear').changing).toBe(
			true,
		);
		await settle();

		expect(extensionRepositoryEnablementQuery.data(workstream.id, 'example.linear')).toMatchObject({
			enabled: true,
			changing: false,
			actionError: null,
		});
		expect(reload).toHaveBeenCalledWith(workstream);
		expect(inspectorPanelCommands.requestFor(workstream.id)?.panelId).toBe('example.linear.panel');
		const saved = await fake.invoke('extensions.read-workstream-file', {
			extensionId: 'malini.workstream-configuration',
			workstreamId: workstream.id,
			path: '.malini/workspace.json',
		});
		expect(JSON.parse(saved)).toMatchObject({
			extensions: { 'example.linear': { enabled: true } },
		});
	});

	it('reports a start failure after the repository opt-in was saved', async () => {
		installFake();
		vi.spyOn(runtime, 'reload').mockResolvedValueOnce({
			activated: [],
			failed: [{ id: 'example.crash', error: new Error('activation exploded') }],
			skipped: [],
		});

		enableExtensionForRepositoryCommand(input('example.crash'));
		await settle();

		expect(extensionRepositoryEnablementQuery.data(workstream.id, 'example.crash')).toMatchObject({
			enabled: true,
			changing: false,
			actionError: 'Enabled for this repository, but it could not start: activation exploded',
		});
		expect(inspectorPanelCommands.requestFor(workstream.id)).toBeNull();
	});

	it('asks to wait while the repository is still opening', () => {
		const fake = installFake();

		enableExtensionForRepositoryCommand({ ...input('example.early'), workstream: null });

		expect(
			extensionRepositoryEnablementQuery.data(workstream.id, 'example.early').actionError,
		).toBe('This repository is still opening. Try again in a moment.');
		expect(fake.calls).toEqual([]);
	});
});

describe('retryExtensionStartCommand', () => {
	it('restarts the extension and opens its panel', async () => {
		installFake();

		retryExtensionStartCommand(input('example.retry'));
		await settle();

		expect(extensionRepositoryEnablementQuery.data(workstream.id, 'example.retry')).toMatchObject({
			changing: false,
			actionError: null,
		});
		expect(inspectorPanelCommands.requestFor(workstream.id)?.panelId).toBe('example.retry.panel');
	});

	it('does not open the panel when the extension fails to activate again', async () => {
		installFake();
		vi.spyOn(runtime, 'reload').mockResolvedValueOnce({
			activated: [],
			failed: [{ id: 'example.flaky', error: new Error('activation exploded') }],
			skipped: [],
		});

		retryExtensionStartCommand(input('example.flaky'));
		await settle();

		expect(
			extensionRepositoryEnablementQuery.data(workstream.id, 'example.flaky').actionError,
		).toBe('Still enabled, but it could not start: activation exploded');
		expect(inspectorPanelCommands.requestFor(workstream.id)).toBeNull();
	});

	it('keeps the extension enabled and explains a repeated start failure', async () => {
		installFake();
		vi.spyOn(runtime, 'reload').mockRejectedValueOnce(new Error('still broken'));

		retryExtensionStartCommand(input('example.stuck'));
		await settle();

		expect(
			extensionRepositoryEnablementQuery.data(workstream.id, 'example.stuck').actionError,
		).toBe('Still enabled, but it could not start: still broken');
	});
});
