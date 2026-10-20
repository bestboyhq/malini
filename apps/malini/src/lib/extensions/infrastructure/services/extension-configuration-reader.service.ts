import type { ExtensionFileStat } from '$contract/system';
import { invoke } from '$shared/port/invoke';

import {
	EMPTY_WORKSTREAM_EXTENSION_CONFIGURATION,
	WORKSTREAM_EXTENSION_CONFIGURATION_PATH,
	WorkstreamExtensionConfigurationError,
	parseWorkstreamExtensionConfiguration,
	type LoadedWorkstreamExtensionConfiguration,
} from '../../domain/workstream-extension-configuration';

export const WORKSTREAM_EXTENSION_CONFIGURATION_READER_ID =
	'malini.workstream-configuration' as const;

class ExtensionConfigurationReaderService {
	async load(workstreamId: string): Promise<LoadedWorkstreamExtensionConfiguration> {
		if (workstreamId.trim().length === 0) {
			throw new Error('Workstream extension configuration requires a workstream id');
		}
		const fileInput = {
			extensionId: WORKSTREAM_EXTENSION_CONFIGURATION_READER_ID,
			workstreamId,
			path: WORKSTREAM_EXTENSION_CONFIGURATION_PATH,
		};
		let stat: ExtensionFileStat | null;
		try {
			stat = await invoke('extensions.stat-workstream-file', fileInput);
		} catch (error) {
			throw new Error(
				`Could not inspect ${WORKSTREAM_EXTENSION_CONFIGURATION_PATH} for workstream ${workstreamId}: ${errorMessage(error)}`,
			);
		}
		if (stat === null) {
			return Object.freeze({
				source: 'missing',
				path: WORKSTREAM_EXTENSION_CONFIGURATION_PATH,
				configuration: EMPTY_WORKSTREAM_EXTENSION_CONFIGURATION,
			});
		}
		if (stat.kind !== 'file') {
			throw new WorkstreamExtensionConfigurationError('must be a file');
		}

		let contents: string;
		try {
			contents = await invoke('extensions.read-workstream-file', fileInput);
		} catch (error) {
			throw new Error(
				`Could not read ${WORKSTREAM_EXTENSION_CONFIGURATION_PATH} for workstream ${workstreamId}: ${errorMessage(error)}`,
			);
		}
		return Object.freeze({
			source: 'repository',
			path: WORKSTREAM_EXTENSION_CONFIGURATION_PATH,
			configuration: parseWorkstreamExtensionConfiguration(contents),
		});
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export const extensionConfigurationReaderService = new ExtensionConfigurationReaderService();
