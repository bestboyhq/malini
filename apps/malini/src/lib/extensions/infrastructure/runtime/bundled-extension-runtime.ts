import {
	ExtensionRegistry,
	type ExtensionAPI,
	type ExtensionManifest,
	type ExtensionLifecycleScope,
	type ExtensionActivationReport,
	type ExtensionDeactivationReason,
} from '@malini/extension-api';

import { bundledExtensions } from './bundled-extensions';

type BundledExtension = (typeof bundledExtensions)[number];

type BundledExtensionRuntimeOptions = {
	createAPI(manifest: ExtensionManifest, lifecycle: ExtensionLifecycleScope): ExtensionAPI;
	extensions?: readonly BundledExtension[];
};

export class BundledExtensionRuntime {
	readonly #registry = new ExtensionRegistry();
	readonly #extensions: readonly BundledExtension[];
	#started = false;

	constructor(options: BundledExtensionRuntimeOptions) {
		this.#extensions = options.extensions ?? bundledExtensions;
		for (const extension of this.#extensions) {
			this.#registry.register({
				manifest: extension.manifest,
				module: extension.module,
				createAPI: options.createAPI,
			});
		}
	}

	get registry(): ExtensionRegistry {
		return this.#registry;
	}

	async start(
		options: { recoveryMode?: boolean; workstreamEnabled?: ReadonlySet<string> } = {},
	): Promise<ExtensionActivationReport> {
		if (this.#started) throw new Error('Bundled extension runtime is already started');
		this.#started = true;
		await this.#setWorkstreamEnabled(options.workstreamEnabled ?? new Set());
		return this.#registry.activateAll(
			options.recoveryMode === undefined ? {} : { recoveryMode: options.recoveryMode },
		);
	}

	async setWorkstreamEnabled(
		enabled: ReadonlySet<string>,
		options: { deactivationReason?: ExtensionDeactivationReason } = {},
	): Promise<ExtensionActivationReport> {
		if (!this.#started) throw new Error('Bundled extension runtime is not started');
		await this.#setWorkstreamEnabled(enabled, options.deactivationReason);
		const activated: string[] = [];
		const failed: Array<{ id: string; error: Error }> = [];
		const skipped: string[] = [];
		for (const extension of this.#extensions) {
			const record = this.#registry.get(extension.manifest.id);
			if (!record?.enabled || record.state === 'active') {
				skipped.push(extension.manifest.id);
				continue;
			}
			try {
				await this.#registry.activate(extension.manifest.id);
				activated.push(extension.manifest.id);
			} catch (error) {
				failed.push({
					id: extension.manifest.id,
					error: error instanceof Error ? error : new Error(String(error)),
				});
			}
		}
		return { activated, failed, skipped };
	}

	async stop(): Promise<void> {
		if (!this.#started) return;
		const failures: Error[] = [];
		for (const extension of [...this.#extensions].reverse()) {
			const record = this.#registry.get(extension.manifest.id);
			if (!record || record.state === 'inactive') continue;
			try {
				await this.#registry.deactivate(extension.manifest.id);
			} catch (error) {
				failures.push(error instanceof Error ? error : new Error(String(error)));
			}
		}
		this.#started = false;
		if (failures.length > 0) {
			throw new AggregateError(failures, 'One or more bundled extensions failed to stop');
		}
	}

	async #setWorkstreamEnabled(
		enabled: ReadonlySet<string>,
		deactivationReason: ExtensionDeactivationReason = 'deactivate',
	): Promise<void> {
		for (const extension of this.#extensions) {
			await this.#registry.setEnabled(
				extension.manifest.id,
				extension.activation === 'built-in' || enabled.has(extension.manifest.id),
				deactivationReason,
			);
		}
	}
}
