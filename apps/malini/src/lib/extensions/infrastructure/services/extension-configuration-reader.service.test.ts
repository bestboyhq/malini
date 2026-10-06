import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ExtensionFileArgs } from '$contract/commands';
import type { ExtensionFileStat } from '$contract/system';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';

import { isWorkstreamExtensionEnabled } from '../../domain/workstream-extension-configuration';
import {
	WORKSTREAM_EXTENSION_CONFIGURATION_READER_ID,
	extensionConfigurationReaderService,
} from './extension-configuration-reader.service';

afterEach(() => {
	setPlatformForTest(null);
});

function load(workstreamId: string): ReturnType<typeof extensionConfigurationReaderService.load> {
	return extensionConfigurationReaderService.load(workstreamId);
}

const WORKSTREAM_ID = 'workstream-42';
const FILE_INPUT = {
	extensionId: WORKSTREAM_EXTENSION_CONFIGURATION_READER_ID,
	workstreamId: WORKSTREAM_ID,
	path: '.malini/workspace.json',
};

function platform(input: {
	stat?: { kind: 'file' | 'directory'; size: number } | null;
	contents?: string;
	statError?: Error;
	readError?: Error;
}): WorkstreamFiles {
	const files: WorkstreamFiles = {
		extensionWorkstreamFiles: {
			stat: input.statError
				? vi
						.fn<(args: ExtensionFileArgs) => Promise<ExtensionFileStat | null>>()
						.mockRejectedValue(input.statError)
				: vi
						.fn<(args: ExtensionFileArgs) => Promise<ExtensionFileStat | null>>()
						.mockResolvedValue(input.stat ?? null),
			readFile: input.readError
				? vi.fn<(args: ExtensionFileArgs) => Promise<string>>().mockRejectedValue(input.readError)
				: vi
						.fn<(args: ExtensionFileArgs) => Promise<string>>()
						.mockResolvedValue(input.contents ?? ''),
		},
	};
	const fake = createFakePlatform();
	fake.define('extensions.stat-workstream-file', files.extensionWorkstreamFiles.stat);
	fake.define('extensions.read-workstream-file', files.extensionWorkstreamFiles.readFile);
	setPlatformForTest(fake);
	return files;
}

type WorkstreamFiles = {
	extensionWorkstreamFiles: {
		stat: Mock<(args: ExtensionFileArgs) => Promise<ExtensionFileStat | null>>;
		readFile: Mock<(args: ExtensionFileArgs) => Promise<string>>;
	};
};

describe('workstream extension configuration reader', () => {
	it('treats a missing repository file as all custom extensions disabled', async () => {
		const fake = platform({ stat: null });

		const loaded = await load(WORKSTREAM_ID);

		expect(loaded).toEqual({
			source: 'missing',
			path: '.malini/workspace.json',
			configuration: { schemaVersion: 1, extensions: {} },
		});
		expect(isWorkstreamExtensionEnabled(loaded.configuration, 'example.preview')).toBe(false);
		expect(fake.extensionWorkstreamFiles.stat).toHaveBeenCalledWith(FILE_INPUT);
		expect(fake.extensionWorkstreamFiles.readFile).not.toHaveBeenCalled();
		expect(Object.isFrozen(loaded)).toBe(true);
	});

	it('reads and parses an existing repository configuration through the workstream port', async () => {
		const fake = platform({
			stat: { kind: 'file', size: 128 },
			contents: JSON.stringify({
				schemaVersion: 1,
				extensions: {
					'acme.linear': {
						enabled: true,
						settings: { 'acme.linear.team': 'engineering' },
					},
				},
			}),
		});

		const loaded = await load(WORKSTREAM_ID);

		expect(loaded.source).toBe('repository');
		expect(loaded.configuration.extensions['acme.linear']).toEqual({
			enabled: true,
			settings: { 'acme.linear.team': 'engineering' },
			automations: [],
		});
		expect(fake.extensionWorkstreamFiles.stat).toHaveBeenCalledWith(FILE_INPUT);
		expect(fake.extensionWorkstreamFiles.readFile).toHaveBeenCalledWith(FILE_INPUT);
	});

	it('rejects a directory and malformed file instead of silently disabling extensions', async () => {
		platform({ stat: { kind: 'directory', size: 0 } });
		await expect(load(WORKSTREAM_ID)).rejects.toThrow(
			'Invalid .malini/workspace.json: must be a file',
		);
		platform({ stat: { kind: 'file', size: 1 }, contents: '{' });
		await expect(load(WORKSTREAM_ID)).rejects.toThrow('Invalid .malini/workspace.json:');
	});

	it('reports stat and read failures with workstream context', async () => {
		platform({ statError: new Error('native stat failed') });
		await expect(load(WORKSTREAM_ID)).rejects.toThrow(
			'Could not inspect .malini/workspace.json for workstream workstream-42: native stat failed',
		);
		platform({ stat: { kind: 'file', size: 10 }, readError: new Error('permission denied') });
		await expect(load(WORKSTREAM_ID)).rejects.toThrow(
			'Could not read .malini/workspace.json for workstream workstream-42: permission denied',
		);
	});

	it('rejects an empty workstream id before touching the platform', async () => {
		const fake = platform({ stat: null });
		await expect(load('   ')).rejects.toThrow('requires a workstream id');
		expect(fake.extensionWorkstreamFiles.stat).not.toHaveBeenCalled();
	});
});
