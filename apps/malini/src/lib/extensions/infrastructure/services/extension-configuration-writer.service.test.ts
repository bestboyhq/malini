import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WriteExtensionWorkstreamFileArgs } from '$contract/commands';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';

import {
	WORKSTREAM_EXTENSION_CONFIGURATION_PATH,
	parseWorkstreamExtensionConfiguration,
	setWorkstreamExtensionEnabled,
} from '../../domain/workstream-extension-configuration';
import { ExtensionConfigurationWriterService } from './extension-configuration-writer.service';

afterEach(() => {
	setPlatformForTest(null);
});

describe('setWorkstreamExtensionEnabled', () => {
	it('preserves repository settings and automations while changing enablement', () => {
		const configuration = parseWorkstreamExtensionConfiguration(
			JSON.stringify({
				schemaVersion: 1,
				extensions: {
					'example.linear': {
						enabled: false,
						settings: {},
						automations: [
							{
								id: 'refresh-linear',
								when: 'when a new workstream is created',
								run: { command: 'example.linear.refresh', args: [] },
							},
						],
					},
				},
			}),
		);

		const enabled = setWorkstreamExtensionEnabled(configuration, 'example.linear', true);

		expect(enabled.extensions['example.linear']).toEqual({
			enabled: true,
			settings: {},
			automations: [
				{
					id: 'refresh-linear',
					enabled: true,
					when: 'when a new workstream is created',
					run: { command: 'example.linear.refresh', args: [] },
				},
			],
		});
		expect(setWorkstreamExtensionEnabled(enabled, 'example.linear', true)).toBe(enabled);
	});

	it('creates the smallest valid opt-in entry', () => {
		const empty = parseWorkstreamExtensionConfiguration('{"schemaVersion":1,"extensions":{}}');
		expect(
			setWorkstreamExtensionEnabled(empty, 'example.workstream-setup', true).extensions,
		).toEqual({
			'example.workstream-setup': { enabled: true, settings: {}, automations: [] },
		});
	});
});

describe('ExtensionConfigurationWriterService', () => {
	it('serializes edits in one repository without losing either extension', async () => {
		const files: Record<string, string> = {};
		let releaseFirstWrite!: () => void;
		const firstWrite = new Promise<void>((resolve) => (releaseFirstWrite = resolve));
		let writes = 0;
		installFakeFiles(files, async (input) => {
			writes += 1;
			if (writes === 1) await firstWrite;
			files[input.workstreamId] = input.contents;
		});
		const writer = new ExtensionConfigurationWriterService();

		const linear = writer.setEnabled('repo-a-workstream', 'example.linear', true);
		const docker = writer.setEnabled('repo-a-workstream', 'example.workstream-setup', true);
		releaseFirstWrite();
		await Promise.all([linear, docker]);

		expect(JSON.parse(files['repo-a-workstream']!)).toMatchObject({
			extensions: {
				'example.linear': { enabled: true },
				'example.workstream-setup': { enabled: true },
			},
		});
	});

	it('does not serialize unrelated repositories behind one another', async () => {
		const files: Record<string, string> = {};
		let releaseRepoA!: () => void;
		const repoABlocked = new Promise<void>((resolve) => (releaseRepoA = resolve));
		const wroteRepoB = vi.fn();
		installFakeFiles(files, async (input) => {
			if (input.workstreamId === 'repo-a') await repoABlocked;
			files[input.workstreamId] = input.contents;
			if (input.workstreamId === 'repo-b') wroteRepoB();
		});
		const writer = new ExtensionConfigurationWriterService();

		const repoA = writer.setEnabled('repo-a', 'example.linear', true);
		await writer.setEnabled('repo-b', 'example.workstream-setup', true);
		expect(wroteRepoB).toHaveBeenCalledOnce();
		releaseRepoA();
		await repoA;
	});

	it('recovers the queue after a failed write so retry remains possible', async () => {
		const files: Record<string, string> = {};
		let fail = true;
		installFakeFiles(files, async (input) => {
			if (fail) {
				fail = false;
				throw new Error('disk full');
			}
			files[input.workstreamId] = input.contents;
		});
		const writer = new ExtensionConfigurationWriterService();

		await expect(writer.setEnabled('repo-a', 'example.linear', true)).rejects.toThrow('disk full');
		await expect(writer.setEnabled('repo-a', 'example.linear', true)).resolves.toMatchObject({
			configuration: { extensions: { 'example.linear': { enabled: true } } },
		});
	});
});

function installFakeFiles(
	files: Record<string, string>,
	write: (input: WriteExtensionWorkstreamFileArgs) => Promise<void>,
): void {
	const fake = createFakePlatform();
	fake.define('extensions.stat-workstream-file', async ({ workstreamId }) => {
		const contents = files[workstreamId];
		return contents ? { kind: 'file', size: contents.length } : null;
	});
	fake.define(
		'extensions.read-workstream-file',
		async ({ workstreamId }) => files[workstreamId] ?? '',
	);
	fake.define('extensions.write-workstream-file', async (input) => {
		expect(input.path).toBe(WORKSTREAM_EXTENSION_CONFIGURATION_PATH);
		await write(input);
	});
	setPlatformForTest(fake);
}
