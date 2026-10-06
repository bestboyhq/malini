import type { ExtensionManifest, ExtensionWorkstream } from '@malini/extension-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { workstreamSnapshotsHook } from '$shared/repositories/repositories.api';

import { DesktopExtensionHost } from './extension-host';

const workstream: ExtensionWorkstream = {
	id: 'workstream-1',
	path: '/worktrees/one',
	repositoryPath: '/worktrees/one',
	branch: 'feature/extensions',
	baseBranch: 'main',
};

const manifest: ExtensionManifest = {
	schemaVersion: 1,
	id: 'example.reader',
	name: 'Reader',
	version: '1.0.0',
	apiVersion: 1,
	description: 'Reads the branch diff',
	publisher: 'Example',
	entrypoint: './dist/index.js',
	activationEvents: ['onStartup'],
};

afterEach(() => {
	workstreamSnapshotsHook().clear();
	setPlatformForTest(null);
	globalThis.localStorage.clear();
});

describe('DesktopExtensionHost', () => {
	it('reads branch diffs through the snapshot cache change totals share', async () => {
		const fake = createFakePlatform();
		const snapshot = vi.fn(async () => ({
			patch: '',
			totals: { additions: 3, deletions: 1, files: 1 },
		}));
		fake.define('repositories.workstream-snapshot', snapshot);
		setPlatformForTest(fake);
		const shared = workstreamSnapshotsHook();
		const host = new DesktopExtensionHost({
			workstream: () => workstream,
			workstreamSnapshots: shared,
			stateStorage: null,
		});
		const api = host.createAPI(manifest, { track: (disposable) => disposable });

		await shared.get({ workstreamId: workstream.id, baseBranch: workstream.baseBranch });
		await api.repository.diff();

		expect(snapshot).toHaveBeenCalledOnce();
		await api.repository.refresh();
		await shared.get({ workstreamId: workstream.id, baseBranch: workstream.baseBranch });
		expect(snapshot).toHaveBeenCalledTimes(2);
	});

	it('shows extension notifications through the native notifier', async () => {
		const fake = createFakePlatform();
		setPlatformForTest(fake);
		const host = new DesktopExtensionHost({
			workstream: () => workstream,
			workstreamSnapshots: workstreamSnapshotsHook(),
			stateStorage: null,
		});

		await host.createAPI(manifest, { track: (disposable) => disposable }).notifications.show({
			title: 'Build finished',
			body: 'All checks passed',
		});

		expect(fake.calls).toEqual([
			{
				command: 'app.notify',
				args: { options: { title: 'Build finished', body: 'All checks passed' } },
			},
		]);
	});
});
