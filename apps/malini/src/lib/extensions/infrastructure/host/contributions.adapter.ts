import type {
	ExtensionAPI,
	ExtensionManifest,
	ExtensionCommandManifest,
	ExtensionCommandRegistration,
	ExtensionDisposable,
	ExtensionLifecycleScope,
	ExtensionPanelManifest,
	ExtensionPanelOpenOptions,
	ExtensionPanelRegistration,
	ExtensionSettingChange,
	ExtensionSettingManifest,
	ExtensionSettingScope,
	ExtensionSettingValue,
	ExtensionWorkflowContext,
	ExtensionWorkflowManifest,
	ExtensionWorkflowRegistration,
	ExtensionWorkstream,
	MaybePromise,
} from '@malini/extension-api';
import { extensionPanelInstanceParts } from '@malini/extension-api';

import { inspectorPanelCommands } from '$shared/extensions/panel-requests.store.svelte';
import type { WorkstreamDocumentOpening } from '$shared/shell/workstream-tabs';
import { workstreamTabs } from '$shared/shell/workstream-tabs.store.svelte';
import type { ExtensionEventListenerFailure } from '../../domain/extension-event-listener-failure';
import type {
	ExtensionSettingStorage,
	ExtensionStateStorage,
} from '../../domain/extension-storage';
import type { PanelRegistryPort } from '../../domain/panel-registry-port';
import { InspectorPanelRegistry } from '../stores/inspector-panel-registry.store.svelte';
import { resolveRepositorySettingScopeId } from '$shared/extensions/repository-setting-scope';

type PanelOpener = (workstreamId: string, panelId: string) => void;

type DocumentOpener = (workstreamId: string, document: WorkstreamDocumentOpening) => void;

const SETTINGS_STORAGE_VERSION = 1 as const;
const SETTINGS_STORAGE_PREFIX = 'malini.extensions.settings.v1';

type ContributionKind = 'panels' | 'commands' | 'settings' | 'workflows';

type PanelRegistry = PanelRegistryPort<ExtensionPanelRegistration>;

type Owned<T> = {
	extensionId: string;
	value: T;
};

type SettingListener = {
	extensionId: string | null;
	listener: (change: ExtensionSettingChange) => MaybePromise<void>;
};

type EventListener = {
	extensionId: string | null;
	listener: (payload: unknown) => MaybePromise<void>;
};

type DesktopExtensionContributionAPI = Pick<
	ExtensionAPI,
	'panels' | 'commands' | 'settings' | 'workflows' | 'events' | 'subscriptions'
>;

type DesktopExtensionContributionHostOptions = {
	panelRegistry?: PanelRegistry;
	settingStorage?: ExtensionSettingStorage;
	currentWorkstream?: () => ExtensionWorkstream | null;
	openPanel?: PanelOpener;
	openDocument?: DocumentOpener;
};

export class WebExtensionSettingStorage implements ExtensionSettingStorage {
	readonly #storage: ExtensionStateStorage;

	constructor(storage: ExtensionStateStorage) {
		this.#storage = storage;
	}

	get(key: string): string | null {
		return this.#storage.getItem(key);
	}

	set(key: string, value: string): void {
		this.#storage.setItem(key, value);
	}

	delete(key: string): void {
		this.#storage.removeItem(key);
	}
}

export class DesktopExtensionContributionHost {
	readonly #panelRegistry: PanelRegistry;
	readonly #settingStorage: ExtensionSettingStorage;
	readonly #currentWorkstream: () => ExtensionWorkstream | null;
	readonly #openPanel: PanelOpener;
	readonly #openDocument: DocumentOpener;
	readonly #panels = new Map<string, Owned<ExtensionPanelRegistration>>();
	readonly #commands = new Map<string, Owned<ExtensionCommandRegistration>>();
	readonly #settings = new Map<string, Owned<ExtensionSettingManifest>>();
	readonly #workflows = new Map<string, Owned<ExtensionWorkflowRegistration>>();
	readonly #settingListeners = new Set<SettingListener>();
	readonly #eventListeners = new Map<string, Set<EventListener>>();

	constructor(options: DesktopExtensionContributionHostOptions = {}) {
		this.#panelRegistry = options.panelRegistry ?? new InspectorPanelRegistry();
		this.#settingStorage = options.settingStorage ?? browserSettingStorage();
		this.#currentWorkstream = options.currentWorkstream ?? (() => null);
		this.#openPanel =
			options.openPanel ??
			((workstreamId, panelId) => inspectorPanelCommands.open(workstreamId, panelId));
		this.#openDocument =
			options.openDocument ??
			((workstreamId, document) => workstreamTabs.open(workstreamId, document));
	}

	createAPI(
		manifest: ExtensionManifest,
		lifecycle: ExtensionLifecycleScope,
	): DesktopExtensionContributionAPI {
		const own = (disposable: ExtensionDisposable): ExtensionDisposable =>
			lifecycle.track(disposable);

		return {
			panels: {
				register: (panel) => own(this.#registerPanel(manifest, panel)),
				open: (panelId, options) => this.#requestPanel(manifest, panelId, options),
			},
			commands: {
				register: (command) => own(this.#registerCommand(manifest, command)),
				execute: (id: string, ...args: readonly unknown[]) => this.executeCommand(id, ...args),
			},
			settings: {
				register: (setting) => own(this.#registerSetting(manifest, setting)),
				get: (id: string, scope?: ExtensionSettingScope) =>
					this.#getOwnedSetting(manifest.id, id, scope),
				set: (id, value, scope) => this.#setOwnedSetting(manifest.id, id, value, scope),
				onDidChange: (listener) => own(this.#registerSettingListener(manifest.id, listener)),
			},
			workflows: {
				register: (workflow) => own(this.#registerWorkflow(manifest, workflow)),
			},
			events: {
				on: <T>(event: string, listener: (payload: T) => MaybePromise<void>) =>
					own(this.#registerEventListener(manifest.id, event, listener)),
				emit: <T>(event: string, payload: T) => this.emit(event, payload),
			},
			subscriptions: {
				add: own,
			},
		};
	}

	listCommands(): readonly ExtensionCommandManifest[] {
		return [...this.#commands.values()].map(({ value: { handler: _, ...manifest } }) => manifest);
	}

	listWorkflows(): readonly ExtensionWorkflowManifest[] {
		return [...this.#workflows.values()].map(({ value: { run: _, ...manifest } }) => manifest);
	}

	listSettings(extensionId?: string): readonly ExtensionSettingManifest[] {
		return [...this.#settings.values()]
			.filter((entry) => extensionId === undefined || entry.extensionId === extensionId)
			.map(({ value }) => value);
	}

	async executeCommand(id: string, ...args: readonly unknown[]): Promise<unknown> {
		const command = this.#commands.get(id)?.value;
		if (!command) throw new Error(`Unknown extension command: ${id}`);
		return await command.handler(...args);
	}

	async executeWorkflow(id: string, context: ExtensionWorkflowContext): Promise<unknown> {
		const workflow = this.#workflows.get(id)?.value;
		if (!workflow) throw new Error(`Unknown extension workflow: ${id}`);
		throwIfAborted(context.signal, `Workflow ${id} was aborted`);
		return await workflow.run(context);
	}

	getSetting(id: string, scope?: ExtensionSettingScope): ExtensionSettingValue {
		const entry = this.#requireSetting(id);
		return this.#readSetting(entry.extensionId, entry.value, scope);
	}

	async setSetting(
		id: string,
		value: ExtensionSettingValue,
		scope?: ExtensionSettingScope,
	): Promise<void> {
		const entry = this.#requireSetting(id);
		await this.#writeSetting(entry.extensionId, entry.value, value, scope);
	}

	onDidChange(
		listener: (change: ExtensionSettingChange) => MaybePromise<void>,
	): ExtensionDisposable {
		return this.#registerSettingListener(null, listener);
	}

	onEvent<T>(event: string, listener: (payload: T) => MaybePromise<void>): ExtensionDisposable {
		return this.#registerEventListener(null, event, listener);
	}

	async emit<T>(event: string, payload: T): Promise<void> {
		assertEventName(event);
		const failures: unknown[] = [];
		for (const entry of [...(this.#eventListeners.get(event) ?? [])]) {
			try {
				await entry.listener(payload);
			} catch (error) {
				failures.push(error);
			}
		}
		if (failures.length > 0) {
			throw new AggregateError(
				failures,
				`One or more listeners failed for extension event ${event}`,
			);
		}
	}

	async emitConcurrentSettled<T>(
		event: string,
		payload: T,
	): Promise<readonly ExtensionEventListenerFailure[]> {
		assertEventName(event);
		const listeners = [...(this.#eventListeners.get(event) ?? [])];
		const results = await Promise.allSettled(
			listeners.map(({ listener }) => invokeEventListener(listener, payload)),
		);
		return results.flatMap((result, index) => {
			if (result.status === 'fulfilled') return [];
			return [
				{
					extensionId: listeners[index]?.extensionId ?? null,
					error: result.reason,
				},
			];
		});
	}

	#registerPanel(
		manifest: ExtensionManifest,
		registration: ExtensionPanelRegistration,
	): ExtensionDisposable {
		const declared = requireDeclared(manifest, 'panels', registration.id);
		if (!registration.component || typeof registration.component.mount !== 'function') {
			throw new Error(`Panel contribution ${registration.id} must provide a component`);
		}
		if (registration.onDidOpen !== undefined && typeof registration.onDidOpen !== 'function') {
			throw new Error(`Panel contribution ${registration.id} onDidOpen must be a function`);
		}
		if (registration.onDidClose !== undefined && typeof registration.onDidClose !== 'function') {
			throw new Error(`Panel contribution ${registration.id} onDidClose must be a function`);
		}
		this.#assertAvailable(this.#panels, 'panels', registration.id);
		const canonical: ExtensionPanelRegistration = {
			...declared,
			component: registration.component,
			...(registration.onDidOpen ? { onDidOpen: registration.onDidOpen } : {}),
			...(registration.onDidClose ? { onDidClose: registration.onDidClose } : {}),
		};
		const inspectorRegistration = this.#panelRegistry.register(canonical);
		this.#panels.set(registration.id, { extensionId: manifest.id, value: canonical });
		return disposable(async () => {
			this.#panels.delete(registration.id);
			await inspectorRegistration.dispose();
		});
	}

	#requestPanel(
		manifest: ExtensionManifest,
		panelId: string,
		options: ExtensionPanelOpenOptions = {},
	): void {
		const panel = this.#panels.get(panelId);
		const parts = panel ? null : extensionPanelInstanceParts(panelId);
		const template = parts ? this.#panels.get(parts.templateId) : undefined;
		const owner = panel ?? (template?.value.instances === true ? template : undefined);
		if (!owner) throw new Error(`Unknown panel contribution: ${panelId}`);
		if (owner.extensionId !== manifest.id) {
			throw new Error(`Extension ${manifest.id} does not own panel ${panelId}`);
		}
		const workstreamId = this.#currentWorkstream()?.id;
		if (!workstreamId) return;
		if (panel) {
			this.#openPanel(workstreamId, panelId);
			return;
		}
		const label = options.label ?? owner.value.label;
		this.#openDocument(workstreamId, {
			id: panelId,
			label,
			icon: options.icon ?? owner.value.icon,
			tooltip: options.tooltip ?? label,
		});
	}

	#registerCommand(
		manifest: ExtensionManifest,
		registration: ExtensionCommandRegistration,
	): ExtensionDisposable {
		const declared = requireDeclared(manifest, 'commands', registration.id);
		if (typeof registration.handler !== 'function') {
			throw new Error(`Command contribution ${registration.id} must provide a handler`);
		}
		this.#assertAvailable(this.#commands, 'commands', registration.id);
		const canonical: ExtensionCommandRegistration = {
			...declared,
			handler: registration.handler,
		};
		this.#commands.set(registration.id, { extensionId: manifest.id, value: canonical });
		return disposable(() => this.#commands.delete(registration.id));
	}

	#registerSetting(
		manifest: ExtensionManifest,
		registration: ExtensionSettingManifest,
	): ExtensionDisposable {
		const declared = requireDeclared(manifest, 'settings', registration.id);
		this.#assertAvailable(this.#settings, 'settings', registration.id);
		this.#settings.set(registration.id, { extensionId: manifest.id, value: declared });
		return disposable(() => this.#settings.delete(registration.id));
	}

	#registerWorkflow(
		manifest: ExtensionManifest,
		registration: ExtensionWorkflowRegistration,
	): ExtensionDisposable {
		const declared = requireDeclared(manifest, 'workflows', registration.id);
		if (typeof registration.run !== 'function') {
			throw new Error(`Workflow contribution ${registration.id} must provide a runner`);
		}
		this.#assertAvailable(this.#workflows, 'workflows', registration.id);
		const canonical: ExtensionWorkflowRegistration = {
			...declared,
			run: registration.run,
		};
		this.#workflows.set(registration.id, { extensionId: manifest.id, value: canonical });
		return disposable(() => this.#workflows.delete(registration.id));
	}

	#registerSettingListener(
		extensionId: string | null,
		listener: (change: ExtensionSettingChange) => MaybePromise<void>,
	): ExtensionDisposable {
		const entry = { extensionId, listener };
		this.#settingListeners.add(entry);
		return disposable(() => this.#settingListeners.delete(entry));
	}

	#registerEventListener<T>(
		extensionId: string | null,
		event: string,
		listener: (payload: T) => MaybePromise<void>,
	): ExtensionDisposable {
		assertEventName(event);
		const group = this.#eventListeners.get(event) ?? new Set<EventListener>();
		const entry: EventListener = {
			extensionId,
			listener: listener as (payload: unknown) => MaybePromise<void>,
		};
		group.add(entry);
		this.#eventListeners.set(event, group);
		return disposable(() => {
			group.delete(entry);
			if (group.size === 0) this.#eventListeners.delete(event);
		});
	}

	#getOwnedSetting(
		extensionId: string,
		id: string,
		scope?: ExtensionSettingScope,
	): ExtensionSettingValue {
		const entry = this.#requireOwnedSetting(extensionId, id);
		return this.#readSetting(extensionId, entry.value, scope);
	}

	async #setOwnedSetting(
		extensionId: string,
		id: string,
		value: ExtensionSettingValue,
		scope?: ExtensionSettingScope,
	): Promise<void> {
		const entry = this.#requireOwnedSetting(extensionId, id);
		await this.#writeSetting(extensionId, entry.value, value, scope);
	}

	#readSetting(
		extensionId: string,
		definition: ExtensionSettingManifest,
		scope?: ExtensionSettingScope,
	): ExtensionSettingValue {
		const resolvedScope = this.#resolveScope(definition, scope);
		const key = extensionSettingStorageKey(extensionId, definition.id, resolvedScope);
		const serialized = this.#settingStorage.get(key);
		if (serialized === null) return definition.default;
		try {
			const stored = JSON.parse(serialized) as { version?: unknown; value?: unknown };
			if (stored.version !== SETTINGS_STORAGE_VERSION) throw new Error('Unknown settings version');
			assertSettingValue(definition, stored.value);
			return stored.value;
		} catch {
			try {
				this.#settingStorage.delete(key);
			} catch {}
			return definition.default;
		}
	}

	async #writeSetting(
		extensionId: string,
		definition: ExtensionSettingManifest,
		value: ExtensionSettingValue,
		scope?: ExtensionSettingScope,
	): Promise<void> {
		assertSettingValue(definition, value);
		const resolvedScope = this.#resolveScope(definition, scope);
		const previous = this.#readSetting(extensionId, definition, resolvedScope);
		if (Object.is(previous, value)) return;
		const key = extensionSettingStorageKey(extensionId, definition.id, resolvedScope);
		this.#settingStorage.set(key, JSON.stringify({ version: SETTINGS_STORAGE_VERSION, value }));
		const change: ExtensionSettingChange = { id: definition.id, value, scope: resolvedScope };
		const failures: unknown[] = [];
		for (const entry of [...this.#settingListeners]) {
			if (entry.extensionId !== null && entry.extensionId !== extensionId) continue;
			try {
				await entry.listener(change);
			} catch (error) {
				failures.push(error);
			}
		}
		if (failures.length > 0) {
			throw new AggregateError(
				failures,
				`One or more listeners failed for extension setting ${definition.id}`,
			);
		}
	}

	#resolveScope(
		definition: ExtensionSettingManifest,
		scope?: ExtensionSettingScope,
	): ExtensionSettingScope {
		if (scope) return assertSettingScope(scope);
		if (!definition.scope || definition.scope === 'global') return { kind: 'global' };
		const workstream = this.#currentWorkstream();
		if (!workstream) {
			throw new Error(
				`Setting ${definition.id} requires an active ${definition.scope} to resolve its scope`,
			);
		}
		if (definition.scope === 'workstream') return { kind: 'workstream', id: workstream.id };
		return {
			kind: 'repository',
			id: assertScopeId(resolveRepositorySettingScopeId(workstream) ?? '', 'repository'),
		};
	}

	#requireSetting(id: string): Owned<ExtensionSettingManifest> {
		const entry = this.#settings.get(id);
		if (!entry) throw new Error(`Unknown extension setting: ${id}`);
		return entry;
	}

	#requireOwnedSetting(extensionId: string, id: string): Owned<ExtensionSettingManifest> {
		const entry = this.#requireSetting(id);
		if (entry.extensionId !== extensionId) {
			throw new Error(`Extension ${extensionId} does not own setting ${id}`);
		}
		return entry;
	}

	#assertAvailable<T>(registry: Map<string, T>, kind: ContributionKind, id: string): void {
		if (registry.has(id)) throw new Error(`Duplicate ${kind} contribution: ${id}`);
	}
}

export function extensionSettingStorageKey(
	extensionId: string,
	settingId: string,
	scope: ExtensionSettingScope,
): string {
	const scoped =
		scope.kind === 'global'
			? 'global'
			: `${scope.kind}.${encodeURIComponent(assertScopeId(scope.id, scope.kind))}`;
	return [
		SETTINGS_STORAGE_PREFIX,
		encodeURIComponent(extensionId),
		scoped,
		encodeURIComponent(settingId),
	].join('/');
}

function browserSettingStorage(): ExtensionSettingStorage {
	if (typeof globalThis.localStorage === 'undefined') {
		throw new Error(
			'DesktopExtensionContributionHost requires settingStorage outside the desktop webview',
		);
	}
	return new WebExtensionSettingStorage(globalThis.localStorage);
}

function requireDeclared(
	manifest: ExtensionManifest,
	kind: 'panels',
	id: string,
): ExtensionPanelManifest;
function requireDeclared(
	manifest: ExtensionManifest,
	kind: 'commands',
	id: string,
): ExtensionCommandManifest;
function requireDeclared(
	manifest: ExtensionManifest,
	kind: 'settings',
	id: string,
): ExtensionSettingManifest;
function requireDeclared(
	manifest: ExtensionManifest,
	kind: 'workflows',
	id: string,
): ExtensionWorkflowManifest;
function requireDeclared(
	manifest: ExtensionManifest,
	kind: ContributionKind,
	id: string,
):
	| ExtensionPanelManifest
	| ExtensionCommandManifest
	| ExtensionSettingManifest
	| ExtensionWorkflowManifest {
	assertContributionNamespace(manifest.id, id);
	const contribution = manifest.contributes?.[kind]?.find((candidate) => candidate.id === id);
	if (!contribution) {
		throw new Error(`${kind} contribution ${id} is not declared by extension ${manifest.id}`);
	}
	return contribution;
}

function assertContributionNamespace(extensionId: string, contributionId: string): void {
	if (!contributionId.startsWith(`${extensionId}.`)) {
		throw new Error(
			`Contribution ${contributionId} must belong to extension namespace ${extensionId}.`,
		);
	}
}

function assertSettingValue(
	definition: ExtensionSettingManifest,
	value: unknown,
): asserts value is ExtensionSettingValue {
	if (definition.type === 'select') {
		if (
			typeof value !== 'string' ||
			!definition.options?.some((option) => option.value === value)
		) {
			throw new Error(`Invalid value for setting ${definition.id}`);
		}
		return;
	}
	if (typeof value !== definition.type) {
		throw new Error(`Invalid value for setting ${definition.id}`);
	}
}

function assertSettingScope(scope: ExtensionSettingScope): ExtensionSettingScope {
	if (scope.kind === 'global') return scope;
	assertScopeId(scope.id, scope.kind);
	return scope;
}

function assertScopeId(id: string, kind: 'repository' | 'workstream'): string {
	if (id.trim().length === 0) throw new Error(`${kind} setting scope requires a non-empty id`);
	return id;
}

function assertEventName(event: string): void {
	if (event.trim().length === 0) throw new Error('Extension event name must not be empty');
}

function invokeEventListener(listener: EventListener['listener'], payload: unknown): Promise<void> {
	try {
		return Promise.resolve(listener(payload));
	} catch (error) {
		return Promise.reject(error);
	}
}

function throwIfAborted(signal: AbortSignal, message: string): void {
	if (!signal.aborted) return;
	throw signal.reason instanceof Error ? signal.reason : new Error(message);
}

function disposable(disposeAction: () => MaybePromise<unknown>): ExtensionDisposable {
	let active = true;
	return {
		dispose: async () => {
			if (!active) return;
			active = false;
			await disposeAction();
		},
	};
}
