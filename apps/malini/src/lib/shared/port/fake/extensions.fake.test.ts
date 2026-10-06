import { describe, expect, it } from 'vitest';
import type { ExtensionSourceSnapshot, ManagedExtensionSourceSnapshot } from '$contract/system';

import { createFakePlatform } from './create-fake-platform';

const WORKSTREAM_ID = 'fake-workstream-chat';

function localSource(id: string): ExtensionSourceSnapshot {
	return {
		id,
		sourceKind: 'local',
		sourcePath: `/extensions/${id}`,
		enabled: true,
		watch: true,
		manifestJson: '{}',
		entrypointSource: 'export default { activate() {} };',
		fingerprint: `${id}-fingerprint`,
		reloadSequence: 0,
		loadError: null,
	};
}

describe('extensions fake: extension packages', () => {
	it('lists seeded local sources as copies the caller cannot mutate', async () => {
		const fake = createFakePlatform({ extensionSources: [localSource('community.local')] });

		const [listed] = await fake.invoke('extensions.list-sources', undefined);
		if (!listed) throw new Error('Expected the seeded local source');
		listed.enabled = false;

		await expect(fake.invoke('extensions.list-sources', undefined)).resolves.toEqual([
			localSource('community.local'),
		]);
	});

	it('has no managed packages, so enabling or rolling one back fails closed', async () => {
		const fake = createFakePlatform();

		await expect(fake.invoke('extensions.list-managed', undefined)).resolves.toEqual([]);
		await expect(
			fake.invoke('extensions.set-managed-enabled', {
				extensionId: 'acme.extension',
				enabled: false,
			}),
		).rejects.toThrow('Managed extension acme.extension is not installed');
		await expect(
			fake.invoke('extensions.rollback-managed', { extensionId: 'acme.extension' }),
		).rejects.toThrow('Managed extension acme.extension has no rollback version');
	});

	it('lists seeded managed packages, toggles them, and rolls back to the previous version', async () => {
		const fake = createFakePlatform({
			managedExtensionSources: [managedSource('2.0.0', 1, ['1.0.0'])],
			managedExtensionHistory: { 'acme.extension': [managedSource('1.0.0', 0, [])] },
		});

		expect(
			(await fake.invoke('extensions.list-sources', undefined)).find(
				({ id }) => id === 'acme.extension',
			)?.sourceKind,
		).toBe('managed');
		expect((await fake.invoke('extensions.list-managed', undefined))[0]?.previousVersions).toEqual([
			'1.0.0',
		]);

		const disabled = await fake.invoke('extensions.set-managed-enabled', {
			extensionId: 'acme.extension',
			enabled: false,
		});
		expect(disabled).toMatchObject({ enabled: false, reloadSequence: 2 });

		const restored = await fake.invoke('extensions.rollback-managed', {
			extensionId: 'acme.extension',
		});
		expect(restored).toMatchObject({ version: '1.0.0', reloadSequence: 3, previousVersions: [] });
		await expect(
			fake.invoke('extensions.rollback-managed', { extensionId: 'acme.extension' }),
		).rejects.toThrow('Managed extension acme.extension has no rollback version');
	});

	it('reports the seeded recovery mode and accepts development logs', async () => {
		const fake = createFakePlatform({ extensionRecoveryMode: true });

		await expect(fake.invoke('extensions.recovery-mode-enabled', undefined)).resolves.toBe(true);
		await expect(
			fake.invoke('extensions.append-development-log', {
				log: {
					timestamp: '2026-01-01T00:00:00.000Z',
					level: 'info',
					extensionId: 'community.local',
					event: 'activated',
					message: '/extensions/community.local',
				},
			}),
		).resolves.toBeUndefined();
	});
});

describe('extensions fake: workstream files', () => {
	it('stores files per workstream and answers stat and glob listings', async () => {
		const fake = createFakePlatform();
		const file = { extensionId: 'malini.repository', workstreamId: WORKSTREAM_ID };

		await fake.invoke('extensions.write-workstream-file', {
			...file,
			path: './src/app.ts',
			contents: 'export {};',
		});

		await expect(
			fake.invoke('extensions.read-repository-file', { ...file, path: 'src/app.ts' }),
		).resolves.toBe('export {};');
		await expect(
			fake.invoke('extensions.stat-workstream-file', { ...file, path: 'src' }),
		).resolves.toEqual({ kind: 'directory', size: 0 });
		await expect(
			fake.invoke('extensions.stat-workstream-file', { ...file, path: 'missing.ts' }),
		).resolves.toBeNull();
		await expect(
			fake.invoke('extensions.list-workstream-files', { ...file, glob: 'src/*.ts' }),
		).resolves.toEqual(['src/app.ts']);
	});

	it('fails closed for an unknown workstream, a missing owner, and escaping paths', async () => {
		const fake = createFakePlatform();

		await expect(
			fake.invoke('extensions.read-workstream-file', {
				extensionId: 'malini.repository',
				workstreamId: 'unknown-workstream',
				path: 'a.txt',
			}),
		).rejects.toThrow('Unknown fake extension workstream');
		await expect(
			fake.invoke('extensions.read-workstream-file', {
				extensionId: ' ',
				workstreamId: WORKSTREAM_ID,
				path: 'a.txt',
			}),
		).rejects.toThrow('requires an extension id');
		await expect(
			fake.invoke('extensions.write-workstream-file', {
				extensionId: 'malini.repository',
				workstreamId: WORKSTREAM_ID,
				path: '/etc/passwd',
				contents: '',
			}),
		).rejects.toThrow('must be relative');
		await expect(
			fake.invoke('extensions.write-workstream-file', {
				extensionId: 'malini.repository',
				workstreamId: WORKSTREAM_ID,
				path: 'src/../../outside.txt',
				contents: '',
			}),
		).rejects.toThrow('escapes its workstream');
	});
});

function managedSource(
	version: string,
	reloadSequence: number,
	previousVersions: string[],
): ManagedExtensionSourceSnapshot {
	return {
		id: 'acme.extension',
		sourceKind: 'managed',
		sourcePath: `/managed/acme.extension/${version}`,
		enabled: true,
		watch: false,
		manifestJson: '{}',
		entrypointSource: `export const version = '${version}';`,
		fingerprint: `acme-${version}`,
		reloadSequence,
		loadError: null,
		version,
		installedAt: '2026-07-12T00:00:00Z',
		releaseJson: '{}',
		previousVersions,
	};
}
