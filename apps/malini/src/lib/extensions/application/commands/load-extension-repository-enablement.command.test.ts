import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';

import { extensionRepositoryEnablementQuery } from '../queries/extension-repository-enablement.query.svelte';
import { loadExtensionRepositoryEnablementCommand } from './load-extension-repository-enablement.command';

const activation = vi.hoisted(() => ({ workstream: new Set<string>() }));

vi.mock('../../domain/bundled-extension-activation', () => ({
	bundledExtensionActivation: (extensionId: string) =>
		activation.workstream.has(extensionId) ? 'workstream' : 'built-in',
}));

const WORKSTREAM_ID = 'fake-workstream-chat';

afterEach(() => {
	activation.workstream.clear();
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

describe('loadExtensionRepositoryEnablementCommand', () => {
	it('never waits on repository configuration for an always-available extension', () => {
		const fake = installFake();

		loadExtensionRepositoryEnablementCommand(WORKSTREAM_ID, 'malini.repository');

		expect(
			extensionRepositoryEnablementQuery.data(WORKSTREAM_ID, 'malini.repository'),
		).toMatchObject({ enabled: false, loading: false, error: null });
		expect(fake.calls).toEqual([]);
	});

	it('reads the repository configuration for a repository-enabled extension', async () => {
		activation.workstream.add('example.linear');
		const fake = installFake();
		fake.define('extensions.stat-workstream-file', async () => ({ kind: 'file', size: 1 }));
		fake.define('extensions.read-workstream-file', async () =>
			JSON.stringify({
				schemaVersion: 1,
				extensions: { 'example.linear': { enabled: true, settings: {} } },
			}),
		);

		loadExtensionRepositoryEnablementCommand(WORKSTREAM_ID, 'example.linear');
		expect(extensionRepositoryEnablementQuery.data(WORKSTREAM_ID, 'example.linear').loading).toBe(
			true,
		);
		await settle();

		expect(extensionRepositoryEnablementQuery.data(WORKSTREAM_ID, 'example.linear')).toMatchObject({
			enabled: true,
			loading: false,
			error: null,
		});
	});

	it('surfaces a configuration read failure as the repository state error', async () => {
		activation.workstream.add('example.broken');
		const fake = installFake();
		fake.define('extensions.stat-workstream-file', async () => {
			throw new Error('permission denied');
		});

		loadExtensionRepositoryEnablementCommand(WORKSTREAM_ID, 'example.broken');
		await settle();

		const state = extensionRepositoryEnablementQuery.data(WORKSTREAM_ID, 'example.broken');
		expect(state.loading).toBe(false);
		expect(state.error).toContain('permission denied');
		expect(state.actionError).toBe(state.error);
	});
});
