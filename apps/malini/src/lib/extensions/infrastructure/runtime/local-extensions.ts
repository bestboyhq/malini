import {
	assertExtensionManifest,
	ExtensionRegistry,
	type ExtensionAPI,
	type ExtensionManifest,
	type ExtensionModule,
	type ExtensionActivationReport,
	type ExtensionLifecycleScope,
	type ExtensionRuntimeRecord,
} from '@malini/extension-api';

import type { ExtensionDevelopmentLog, ExtensionSourceSnapshot } from '$contract/system';
import { invoke } from '$shared/port/invoke';

type LoadedLocalExtension = {
	source: ExtensionSourceSnapshot;
	registry: ExtensionRegistry;
};

type ExtensionLogLevel = 'debug' | 'info' | 'warn' | 'error';

type LocalExtensionsOptions = {
	createAPI(manifest: ExtensionManifest, lifecycle: ExtensionLifecycleScope): ExtensionAPI;
	importSource?: (source: ExtensionSourceSnapshot) => Promise<ExtensionModule>;
	pollIntervalMs?: number;
};

export class LocalExtensions {
	readonly #createAPI: LocalExtensionsOptions['createAPI'];
	readonly #importSource: NonNullable<LocalExtensionsOptions['importSource']>;
	readonly #pollIntervalMs: number;
	readonly #loaded = new Map<string, LoadedLocalExtension>();
	readonly #attemptedRevision = new Map<string, string>();
	#poll: ReturnType<typeof setTimeout> | null = null;
	#transition = Promise.resolve();
	#started = false;
	#recoveryMode = false;

	constructor(options: LocalExtensionsOptions) {
		this.#createAPI = options.createAPI;
		this.#importSource = options.importSource ?? importSelfContainedModule;
		this.#pollIntervalMs = options.pollIntervalMs ?? 500;
	}

	list(): readonly ExtensionRuntimeRecord[] {
		return [...this.#loaded.values()].flatMap(({ registry }) => registry.list());
	}

	async start(options: { recoveryMode?: boolean } = {}): Promise<ExtensionActivationReport> {
		if (this.#started) throw new Error('Local extension runtime is already started');
		this.#started = true;
		this.#recoveryMode =
			options.recoveryMode === true ||
			(await invoke('extensions.recovery-mode-enabled', undefined));
		if (this.#recoveryMode) {
			let sources: readonly ExtensionSourceSnapshot[] = [];
			try {
				sources = await invoke('extensions.list-sources', undefined);
			} catch (error) {
				await this.#log(
					null,
					'warn',
					'recovery-registry-skipped',
					`Community registry was not read in recovery mode: ${asError(error).message}`,
				);
			}
			for (const source of sources) {
				await this.#log(source.id, 'warn', 'recovery-skipped', 'Skipped in recovery mode');
			}
			return { activated: [], failed: [], skipped: sources.map(({ id }) => id) };
		}
		const report = await this.sync();
		this.#schedulePoll();
		return report;
	}

	async sync(): Promise<ExtensionActivationReport> {
		if (this.#recoveryMode) return { activated: [], failed: [], skipped: [] };
		const sources = await invoke('extensions.list-sources', undefined);
		const activated: string[] = [];
		const failed: Array<{ id: string; error: Error }> = [];
		const skipped: string[] = [];
		const seen = new Set<string>();
		for (const source of sources) {
			if (seen.has(source.id)) {
				const error = new Error(`Duplicate installed extension id: ${source.id}`);
				failed.push({ id: source.id, error });
				await this.#log(source.id, 'error', 'load-failed', error.message);
				continue;
			}
			seen.add(source.id);
			if (!source.enabled) {
				await this.#stopOne(source.id);
				this.#attemptedRevision.delete(source.id);
				skipped.push(source.id);
				continue;
			}
			const revision = source.watch
				? `${source.fingerprint}:${source.reloadSequence}:${source.loadError ?? ''}`
				: `manual:${source.reloadSequence}`;
			const loaded = this.#loaded.get(source.id);
			if (
				loaded &&
				loaded.source.reloadSequence === source.reloadSequence &&
				(!source.watch || loaded.source.fingerprint === source.fingerprint)
			) {
				skipped.push(source.id);
				continue;
			}
			if (this.#attemptedRevision.get(source.id) === revision) {
				skipped.push(source.id);
				continue;
			}
			this.#attemptedRevision.set(source.id, revision);
			if (source.loadError) {
				const error = new Error(source.loadError);
				failed.push({ id: source.id, error });
				await this.#log(source.id, 'error', 'load-failed', error.message);
				continue;
			}
			let manifest: ExtensionManifest;
			let module: ExtensionModule;
			try {
				manifest = assertExtensionManifest(JSON.parse(source.manifestJson));
				if (manifest.id !== source.id) {
					throw new Error(`Source id ${source.id} does not match manifest id ${manifest.id}`);
				}
				module = await this.#importSource(source);
			} catch (error) {
				const failure = asError(error);
				failed.push({ id: source.id, error: failure });
				await this.#log(source.id, 'error', 'load-failed', failure.message);
				continue;
			}
			await this.#stopOne(source.id);
			try {
				const registry = new ExtensionRegistry();
				registry.register({ manifest, module, createAPI: this.#createAPI });
				this.#loaded.set(source.id, { source, registry });
				await registry.activate(source.id);
				activated.push(source.id);
				await this.#log(source.id, 'info', loaded ? 'reloaded' : 'activated', source.sourcePath);
			} catch (error) {
				const failure = asError(error);
				failed.push({ id: source.id, error: failure });
				await this.#stopOne(source.id);
				if (loaded) {
					try {
						await loaded.registry.activate(source.id);
						this.#loaded.set(source.id, loaded);
						await this.#log(source.id, 'warn', 'reload-rolled-back', loaded.source.fingerprint);
					} catch (rollbackError) {
						await this.#log(source.id, 'error', 'rollback-failed', asError(rollbackError).message);
					}
				}
				await this.#log(source.id, 'error', 'activation-failed', failure.message);
			}
		}
		for (const id of [...this.#loaded.keys()]) {
			if (!seen.has(id)) {
				await this.#stopOne(id);
				this.#attemptedRevision.delete(id);
			}
		}
		for (const id of [...this.#attemptedRevision.keys()]) {
			if (!seen.has(id)) this.#attemptedRevision.delete(id);
		}
		return { activated, failed, skipped };
	}

	async stop(): Promise<void> {
		this.#started = false;
		if (this.#poll) clearTimeout(this.#poll);
		this.#poll = null;
		await this.#transition;
		for (const id of [...this.#loaded.keys()].reverse()) await this.#stopOne(id);
		this.#attemptedRevision.clear();
		this.#recoveryMode = false;
	}

	#schedulePoll(): void {
		if (!this.#started || this.#recoveryMode || this.#poll) return;
		this.#poll = setTimeout(() => {
			this.#poll = null;
			const previous = this.#transition;
			this.#transition = (async () => {
				try {
					await previous;
					await this.sync();
				} catch (error) {
					await this.#log(null, 'error', 'poll-failed', asError(error).message);
				} finally {
					this.#schedulePoll();
				}
			})();
		}, this.#pollIntervalMs);
	}

	async #stopOne(id: string): Promise<void> {
		const loaded = this.#loaded.get(id);
		if (!loaded) return;
		this.#loaded.delete(id);
		try {
			await loaded.registry.deactivate(id);
		} catch (error) {
			await this.#log(id, 'error', 'deactivation-failed', asError(error).message);
		}
	}

	async #log(
		extensionId: string | null,
		level: ExtensionLogLevel,
		event: string,
		message: string,
	): Promise<void> {
		const entry: ExtensionDevelopmentLog = {
			timestamp: new Date().toISOString(),
			level,
			extensionId,
			event,
			message,
		};
		const label = extensionId ? `[extension ${extensionId}]` : '[extensions]';
		const method = level === 'debug' ? 'debug' : level;
		console[method](`${label} ${event}: ${message}`);
		try {
			await invoke('extensions.append-development-log', { log: entry });
		} catch (error) {
			console.warn(`${label} could not persist development log: ${asError(error).message}`);
		}
	}
}

async function importSelfContainedModule(
	source: ExtensionSourceSnapshot,
): Promise<ExtensionModule> {
	const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(source.entrypointSource)}#${source.fingerprint}`;
	const imported: unknown = await import(/* @vite-ignore */ url);
	const candidate =
		isRecord(imported) && imported.default !== undefined ? imported.default : imported;
	if (!isExtensionModule(candidate)) {
		throw new Error('Extension entrypoint must export activate() or a default ExtensionModule');
	}
	return candidate;
}

function isExtensionModule(value: unknown): value is ExtensionModule {
	if (!isRecord(value)) return false;
	return (
		typeof value.activate === 'function' &&
		(value.deactivate === undefined || typeof value.deactivate === 'function')
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
