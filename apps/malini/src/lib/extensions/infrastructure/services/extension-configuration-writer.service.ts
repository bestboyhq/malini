import { invoke } from '$shared/port/invoke';

import {
	WORKSTREAM_EXTENSION_CONFIGURATION_PATH,
	setWorkstreamExtensionEnabled,
	type LoadedWorkstreamExtensionConfiguration,
} from '../../domain/workstream-extension-configuration';
import {
	WORKSTREAM_EXTENSION_CONFIGURATION_READER_ID,
	extensionConfigurationReaderService,
} from './extension-configuration-reader.service';

export class ExtensionConfigurationWriterService {
	readonly #transitions = new Map<string, Promise<unknown>>();

	setEnabled(
		workstreamId: string,
		extensionId: string,
		enabled: boolean,
	): Promise<LoadedWorkstreamExtensionConfiguration> {
		const prior = this.#transitions.get(workstreamId) ?? Promise.resolve();
		const transition = this.#runTransition(prior, workstreamId, extensionId, enabled);
		this.#transitions.set(workstreamId, transition);
		const clear = (): void => {
			if (this.#transitions.get(workstreamId) === transition) {
				this.#transitions.delete(workstreamId);
			}
		};
		void settled(transition).finally(clear);
		return transition;
	}

	async #runTransition(
		prior: Promise<unknown>,
		workstreamId: string,
		extensionId: string,
		enabled: boolean,
	): Promise<LoadedWorkstreamExtensionConfiguration> {
		await settled(prior);
		return this.#setEnabled(workstreamId, extensionId, enabled);
	}

	async #setEnabled(
		workstreamId: string,
		extensionId: string,
		enabled: boolean,
	): Promise<LoadedWorkstreamExtensionConfiguration> {
		const loaded = await extensionConfigurationReaderService.load(workstreamId);
		const configuration = setWorkstreamExtensionEnabled(loaded.configuration, extensionId, enabled);
		if (configuration === loaded.configuration) return loaded;

		await invoke('extensions.write-workstream-file', {
			extensionId: WORKSTREAM_EXTENSION_CONFIGURATION_READER_ID,
			workstreamId,
			path: WORKSTREAM_EXTENSION_CONFIGURATION_PATH,
			contents: `${JSON.stringify(configuration, null, '\t')}\n`,
		});

		const verified = await extensionConfigurationReaderService.load(workstreamId);
		if (verified.configuration.extensions[extensionId]?.enabled !== enabled) {
			throw new Error(
				`Could not verify that ${extensionId} was ${enabled ? 'enabled' : 'disabled'} for this repository`,
			);
		}
		return verified;
	}
}

async function settled(promise: Promise<unknown>): Promise<void> {
	try {
		await promise;
	} catch {
		return;
	}
}

export const extensionConfigurationWriterService = new ExtensionConfigurationWriterService();
