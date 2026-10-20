import { assertExtensionManifest, type ExtensionManifest } from './manifest.js';
import type {
	ExtensionAPI,
	ExtensionModule,
	ExtensionDeactivationReason,
	ExtensionDisposable,
	ExtensionRuntimeState,
} from './types.js';
import { EXTENSION_EVENTS } from './types.js';

export type ExtensionRuntimeRecord = {
	manifest: ExtensionManifest;
	state: ExtensionRuntimeState;
	error: Error | null;
	enabled: boolean;
};

export type ExtensionActivationReport = {
	activated: readonly string[];
	failed: readonly { id: string; error: Error }[];
	skipped: readonly string[];
};

export type ExtensionLifecycleScope = {
	track(
		disposable: ExtensionDisposable,
		policy?: ExtensionLifecycleDisposePolicy,
	): ExtensionDisposable;
};

export type ExtensionLifecycleDisposePolicy = {
	preserveOnReload?: boolean;
	preserveOnWorkstreamTransition?: boolean;
};

type LoadedExtension = {
	manifest: ExtensionManifest;
	module: ExtensionModule;
	api: ExtensionAPI;
	state: ExtensionRuntimeState;
	error: Error | null;
	enabled: boolean;
	subscriptions: Map<ExtensionDisposable, ExtensionLifecycleDisposePolicy>;
};

export class ExtensionRegistry {
	readonly #extensions = new Map<string, LoadedExtension>();

	register(input: {
		manifest: unknown;
		module: ExtensionModule;
		createAPI: (manifest: ExtensionManifest, lifecycle: ExtensionLifecycleScope) => ExtensionAPI;
	}): void {
		const manifest = assertExtensionManifest(input.manifest);
		if (this.#extensions.has(manifest.id)) {
			throw new Error(`Duplicate extension id: ${manifest.id}`);
		}
		const api = input.createAPI(manifest, {
			track: (disposable, policy) => this.track(manifest.id, disposable, policy),
		});
		this.#extensions.set(manifest.id, {
			manifest,
			module: input.module,
			api,
			state: 'inactive',
			error: null,
			enabled: true,
			subscriptions: new Map(),
		});
	}

	list(): readonly ExtensionRuntimeRecord[] {
		return [...this.#extensions.values()].map(({ manifest, state, error, enabled }) => ({
			manifest,
			state,
			error,
			enabled,
		}));
	}

	get(id: string): ExtensionRuntimeRecord | null {
		const extension = this.#extensions.get(id);
		return extension
			? {
					manifest: extension.manifest,
					state: extension.state,
					error: extension.error,
					enabled: extension.enabled,
				}
			: null;
	}

	async activateAll(options: { recoveryMode?: boolean } = {}): Promise<ExtensionActivationReport> {
		const activated: string[] = [];
		const failed: Array<{ id: string; error: Error }> = [];
		const skipped: string[] = [];
		for (const extension of this.#extensions.values()) {
			if (options.recoveryMode || !extension.enabled) {
				skipped.push(extension.manifest.id);
				continue;
			}
			try {
				await this.activate(extension.manifest.id);
				activated.push(extension.manifest.id);
			} catch (error) {
				failed.push({ id: extension.manifest.id, error: asError(error) });
			}
		}
		return { activated, failed, skipped };
	}

	async setEnabled(
		id: string,
		enabled: boolean,
		deactivationReason: ExtensionDeactivationReason = 'deactivate',
	): Promise<void> {
		const extension = this.#require(id);
		if (extension.enabled === enabled) return;
		if (!enabled && extension.state !== 'inactive') {
			await this.#deactivate(id, deactivationReason);
		}
		extension.enabled = enabled;
	}

	async activate(id: string): Promise<void> {
		const extension = this.#require(id);
		if (!extension.enabled) throw new Error(`Extension ${id} is disabled`);
		if (extension.state === 'active') return;
		if (extension.state === 'activating' || extension.state === 'deactivating') {
			throw new Error(`Extension ${id} is ${extension.state}`);
		}
		if (extension.state === 'failed') {
			await this.#deactivate(id, 'deactivate');
		}
		extension.state = 'activating';
		extension.error = null;
		try {
			await extension.module.activate(extension.api);
			extension.state = 'active';
		} catch (error) {
			extension.error = asError(error);
			extension.state = 'failed';
			await this.#dispose(extension);
			throw extension.error;
		}
	}

	async deactivate(id: string, reason: ExtensionDeactivationReason = 'deactivate'): Promise<void> {
		await this.#deactivate(id, reason);
	}

	async #deactivate(id: string, reason: ExtensionDeactivationReason): Promise<void> {
		const extension = this.#require(id);
		if (extension.state === 'inactive') return;
		extension.state = 'deactivating';
		let failure: Error | null = null;
		try {
			await extension.module.deactivate?.(reason);
		} catch (error) {
			failure = asError(error);
		}
		try {
			await this.#dispose(extension, reason);
		} catch (error) {
			failure ??= asError(error);
		}
		extension.error = failure;
		extension.state = failure ? 'failed' : 'inactive';
		if (failure) throw failure;
	}

	async reload(id: string): Promise<void> {
		const extension = this.#require(id);
		await extension.api.events.emit(EXTENSION_EVENTS.extensionReloadRequested, {
			extensionId: id,
		});
		await this.#deactivate(id, 'reload');
		await this.activate(id);
	}

	async recover(): Promise<readonly string[]> {
		const failed: string[] = [];
		for (const extension of this.#extensions.values()) {
			if (extension.state !== 'failed') continue;
			try {
				await this.#deactivate(extension.manifest.id, 'deactivate');
			} catch {
				failed.push(extension.manifest.id);
			}
		}
		return failed;
	}

	track(
		id: string,
		disposable: ExtensionDisposable,
		policy: ExtensionLifecycleDisposePolicy = {},
	): ExtensionDisposable {
		const extension = this.#require(id);
		extension.subscriptions.set(disposable, policy);
		return {
			dispose: async () => {
				await disposable.dispose();
				extension.subscriptions.delete(disposable);
			},
		};
	}

	async #dispose(
		extension: LoadedExtension,
		reason: ExtensionDeactivationReason = 'deactivate',
	): Promise<void> {
		const disposables = [...extension.subscriptions].reverse();
		const failures: Error[] = [];
		for (const [disposable, policy] of disposables) {
			if (
				(reason === 'reload' && policy.preserveOnReload) ||
				(reason === 'workstream-transition' && policy.preserveOnWorkstreamTransition)
			) {
				continue;
			}
			try {
				await disposable.dispose();
				extension.subscriptions.delete(disposable);
			} catch (error) {
				failures.push(asError(error));
			}
		}
		if (failures.length > 0) {
			throw new AggregateError(failures, `Failed to clean up extension ${extension.manifest.id}`);
		}
	}

	#require(id: string): LoadedExtension {
		const extension = this.#extensions.get(id);
		if (!extension) throw new Error(`Unknown extension: ${id}`);
		return extension;
	}
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
