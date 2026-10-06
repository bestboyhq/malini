import type {
	ExtensionManifest,
	ExtensionDisposable,
	ExtensionLifecycleScope,
	ExtensionPanelContext,
	ExtensionWorkstream,
} from '@malini/extension-api';
import { describe, expect, it } from 'vitest';

import { InspectorPanelRegistry } from '../stores/inspector-panel-registry.store.svelte';
import type { WorkstreamDocumentOpening } from '$shared/shell/workstream-tabs';
import type { ExtensionSettingStorage } from '../../domain/extension-storage';
import {
	DesktopExtensionContributionHost,
	extensionSettingStorageKey,
} from './contributions.adapter';

const workstream: ExtensionWorkstream = {
	id: 'workstream-1',
	path: '/repo/worktree',
	repositoryPath: '/repo',
	branch: 'feature/extensions',
	baseBranch: 'main',
};

const exampleManifest = manifest('acme.example', {
	panels: [{ id: 'acme.example.main-panel', label: 'Main', icon: 'panel-icon', order: 20 }],
	commands: [{ id: 'acme.example.echo', title: 'Echo', description: 'Echo a value' }],
	settings: [
		{
			id: 'acme.example.mode',
			label: 'Mode',
			type: 'select',
			default: 'smart',
			options: [
				{ label: 'Smart', value: 'smart' },
				{ label: 'Manual', value: 'manual' },
			],
			scope: 'repository',
		},
		{
			id: 'acme.example.enabled',
			label: 'Enabled',
			type: 'boolean',
			default: true,
		},
		{
			id: 'acme.example.label',
			label: 'Label',
			type: 'string',
			default: '',
			scope: 'workstream',
		},
	],
	workflows: [{ id: 'acme.example.inspect', label: 'Inspect repository' }],
});

const documentsManifest = manifest('acme.docs', {
	panels: [
		{ id: 'acme.docs.index', label: 'Index', icon: 'index-icon', order: 20 },
		{ id: 'acme.docs.page', label: 'Page', icon: 'page-icon', instances: true },
	],
});

describe('DesktopExtensionContributionHost', () => {
	it('accepts only manifest-declared, extension-namespaced panels and delegates them to the inspector', async () => {
		const panels = new InspectorPanelRegistry();
		const lifecycle = new TestLifecycle();
		const host = createHost({ panels });
		const api = host.createAPI(exampleManifest, lifecycle);
		const component = { mount: () => ({ dispose: () => undefined }) };
		let openCount = 0;
		const onDidOpen = () => {
			openCount += 1;
		};
		let closeCount = 0;
		const onDidClose = () => {
			closeCount += 1;
		};

		const registration = api.panels.register({
			id: 'acme.example.main-panel',
			label: 'Runtime label must not override the manifest',
			icon: 'runtime-icon',
			component,
			onDidOpen,
			onDidClose,
		});

		expect(panels.panels).toEqual([
			{
				...exampleManifest.contributes!.panels![0]!,
				component,
				onDidOpen,
				onDidClose,
			},
		]);
		await panels.panels[0]?.onDidOpen?.(panelContext());
		expect(openCount).toBe(1);
		await panels.panels[0]?.onDidClose?.();
		expect(closeCount).toBe(1);
		expect(() =>
			api.panels.register({
				id: 'acme.example.main-panel',
				label: 'Main',
				icon: 'panel-icon',
				component,
			}),
		).toThrow('Duplicate panels contribution: acme.example.main-panel');
		expect(() =>
			api.panels.register({
				id: 'acme.example.undeclared',
				label: 'Undeclared',
				icon: 'panel-icon',
				component,
			}),
		).toThrow(
			'panels contribution acme.example.undeclared is not declared by extension acme.example',
		);

		await registration.dispose();
		expect(panels.panels).toEqual([]);
		api.panels.register({
			...exampleManifest.contributes!.panels![0]!,
			component,
		});
		await lifecycle.disposeAll();
		expect(panels.panels).toEqual([]);
	});

	it('keeps a document template out of the inspector and serves it by its id', async () => {
		const panels = new InspectorPanelRegistry();
		const lifecycle = new TestLifecycle();
		const host = createHost({ panels });
		const api = host.createAPI(documentsManifest, lifecycle);
		const component = { mount: () => ({ dispose: () => undefined }) };

		api.panels.register({ id: 'acme.docs.index', label: 'Index', icon: 'index-icon', component });
		api.panels.register({ id: 'acme.docs.page', label: 'Page', icon: 'page-icon', component });

		expect(panels.panels.map(({ id }) => id)).toEqual(['acme.docs.index']);
		expect(panels.documentTemplate('acme.docs.page')?.component).toBe(component);
		expect(panels.documentTemplate('acme.docs.index')).toBeNull();
		expect(() =>
			api.panels.register({
				id: 'acme.docs.page:guide/intro.md',
				label: 'intro.md',
				icon: 'path:guide/intro.md',
				component,
			}),
		).toThrow(
			'panels contribution acme.docs.page:guide/intro.md is not declared by extension acme.docs',
		);

		await lifecycle.disposeAll();
		expect(panels.documentTemplate('acme.docs.page')).toBeNull();
	});

	it('opens an instance of its own template as a document of the current workstream', () => {
		const opened: { workstreamId: string; document: WorkstreamDocumentOpening }[] = [];
		const inspectorOpened: string[] = [];
		const host = createHost({
			openPanel: (_workstreamId, panelId) => inspectorOpened.push(panelId),
			openDocument: (workstreamId, document) => opened.push({ workstreamId, document }),
		});
		const api = host.createAPI(documentsManifest, new TestLifecycle());
		const component = { mount: () => ({ dispose: () => undefined }) };

		expect(() => api.panels.open('acme.docs.page:guide/intro.md')).toThrow(
			'Unknown panel contribution: acme.docs.page:guide/intro.md',
		);
		api.panels.register({ id: 'acme.docs.index', label: 'Index', icon: 'index-icon', component });
		api.panels.register({ id: 'acme.docs.page', label: 'Page', icon: 'page-icon', component });

		api.panels.open('acme.docs.page:guide/intro.md', {
			label: 'intro.md',
			icon: 'path:guide/intro.md',
			tooltip: 'guide/intro.md',
		});
		api.panels.open('acme.docs.page:notes.md');

		expect(opened).toEqual([
			{
				workstreamId: workstream.id,
				document: {
					id: 'acme.docs.page:guide/intro.md',
					label: 'intro.md',
					icon: 'path:guide/intro.md',
					tooltip: 'guide/intro.md',
				},
			},
			{
				workstreamId: workstream.id,
				document: {
					id: 'acme.docs.page:notes.md',
					label: 'Page',
					icon: 'page-icon',
					tooltip: 'Page',
				},
			},
		]);
		expect(inspectorOpened).toEqual([]);
		expect(() => api.panels.open('acme.docs.index:guide/intro.md')).toThrow(
			'Unknown panel contribution: acme.docs.index:guide/intro.md',
		);
		const other = host.createAPI(manifest('acme.other', { panels: [] }), new TestLifecycle());
		expect(() => other.panels.open('acme.docs.page:guide/intro.md')).toThrow(
			'Extension acme.other does not own panel acme.docs.page:guide/intro.md',
		);
	});

	it('opens only a registered panel this extension owns, against the current workstream', () => {
		const lifecycle = new TestLifecycle();
		const opened: { workstreamId: string; panelId: string }[] = [];
		const host = createHost({
			openPanel: (workstreamId, panelId) => opened.push({ workstreamId, panelId }),
		});
		const api = host.createAPI(exampleManifest, lifecycle);
		const component = { mount: () => ({ dispose: () => undefined }) };

		expect(() => api.panels.open('acme.example.main-panel')).toThrow(
			'Unknown panel contribution: acme.example.main-panel',
		);

		api.panels.register({
			id: 'acme.example.main-panel',
			label: 'Main',
			icon: 'panel-icon',
			component,
		});
		api.panels.open('acme.example.main-panel');

		expect(opened).toEqual([{ workstreamId: 'workstream-1', panelId: 'acme.example.main-panel' }]);

		const other = host.createAPI(manifest('acme.other', { panels: [] }), new TestLifecycle());
		expect(() => other.panels.open('acme.example.main-panel')).toThrow(
			'Extension acme.other does not own panel acme.example.main-panel',
		);
	});

	it('rejects a declared contribution outside its owning extension namespace', () => {
		const lifecycle = new TestLifecycle();
		const host = createHost();
		const invalid = manifest('acme.owner', {
			commands: [{ id: 'someone.else.command', title: 'Foreign command' }],
		});
		const api = host.createAPI(invalid, lifecycle);

		expect(() =>
			api.commands.register({
				...invalid.contributes!.commands![0]!,
				handler: () => undefined,
			}),
		).toThrow('Contribution someone.else.command must belong to extension namespace acme.owner.');
	});

	it('executes commands and workflows, rejects duplicates, and removes both on disposal', async () => {
		const lifecycle = new TestLifecycle();
		const host = createHost();
		const api = host.createAPI(exampleManifest, lifecycle);
		api.commands.register({
			...exampleManifest.contributes!.commands![0]!,
			handler: (value) => `echo:${String(value)}`,
		});
		api.workflows.register({
			...exampleManifest.contributes!.workflows![0]!,
			run: ({ input, report }) => {
				report({ status: 'running', message: 'Inspecting' });
				return { inspected: input.path };
			},
		});

		expect(host.listCommands()).toEqual(exampleManifest.contributes!.commands);
		expect(host.listWorkflows()).toEqual(exampleManifest.contributes!.workflows);
		expect(await api.commands.execute('acme.example.echo', 'hello')).toBe('echo:hello');
		expect(await host.executeCommand('acme.example.echo', 'host')).toBe('echo:host');
		const updates: unknown[] = [];
		expect(
			await host.executeWorkflow('acme.example.inspect', {
				workstream,
				input: { path: 'src' },
				report: (update) => updates.push(update),
				signal: new AbortController().signal,
			}),
		).toEqual({ inspected: 'src' });
		expect(updates).toEqual([{ status: 'running', message: 'Inspecting' }]);
		expect(() =>
			api.commands.register({
				...exampleManifest.contributes!.commands![0]!,
				handler: () => undefined,
			}),
		).toThrow('Duplicate commands contribution: acme.example.echo');

		await lifecycle.disposeAll();
		expect(host.listCommands()).toEqual([]);
		expect(host.listWorkflows()).toEqual([]);
		await expect(host.executeCommand('acme.example.echo')).rejects.toThrow(
			'Unknown extension command: acme.example.echo',
		);
		await expect(
			host.executeWorkflow('acme.example.inspect', {
				workstream,
				input: {},
				report: () => undefined,
				signal: new AbortController().signal,
			}),
		).rejects.toThrow('Unknown extension workflow: acme.example.inspect');
	});

	it('persists validated setting values independently by scope and retains them across reloads', async () => {
		const storage = new MemorySettingStorage();
		const lifecycle = new TestLifecycle();
		const host = createHost({ storage });
		const api = host.createAPI(exampleManifest, lifecycle);
		for (const setting of exampleManifest.contributes!.settings!) api.settings.register(setting);
		const localChanges: unknown[] = [];
		const hostChanges: unknown[] = [];
		api.settings.onDidChange((change) => {
			localChanges.push(change);
		});
		host.onDidChange((change) => {
			hostChanges.push(change);
		});

		expect(api.settings.get('acme.example.mode')).toBe('smart');
		await api.settings.set('acme.example.mode', 'manual');
		await api.settings.set('acme.example.mode', 'smart', {
			kind: 'workstream',
			id: 'workstream-2',
		});
		expect(api.settings.get('acme.example.mode')).toBe('manual');
		expect(api.settings.get('acme.example.mode', { kind: 'workstream', id: 'workstream-2' })).toBe(
			'smart',
		);
		expect(localChanges).toEqual([
			{
				id: 'acme.example.mode',
				value: 'manual',
				scope: { kind: 'repository', id: '/repo' },
			},
		]);
		expect(hostChanges).toEqual(localChanges);
		expect(storage.keys()).toEqual([
			extensionSettingStorageKey('acme.example', 'acme.example.mode', {
				kind: 'repository',
				id: '/repo',
			}),
		]);
		await expect(api.settings.set('acme.example.mode', 'automatic')).rejects.toThrow(
			'Invalid value for setting acme.example.mode',
		);
		await expect(api.settings.set('acme.example.enabled', 'yes')).rejects.toThrow(
			'Invalid value for setting acme.example.enabled',
		);
		await expect(
			api.settings.set('acme.example.label', 'name', { kind: 'workstream', id: ' ' }),
		).rejects.toThrow('workstream setting scope requires a non-empty id');

		await lifecycle.disposeAll();
		expect(host.listSettings()).toEqual([]);

		const reloadedLifecycle = new TestLifecycle();
		const reloadedHost = createHost({ storage });
		const reloadedAPI = reloadedHost.createAPI(exampleManifest, reloadedLifecycle);
		for (const setting of exampleManifest.contributes!.settings!)
			reloadedAPI.settings.register(setting);
		expect(reloadedAPI.settings.get('acme.example.mode')).toBe('manual');
		await reloadedLifecycle.disposeAll();
	});

	it('shares repository settings across workstreams from one repository and isolates another repository', async () => {
		const storage = new MemorySettingStorage();
		let currentWorkstream: ExtensionWorkstream = {
			...workstream,
			id: 'workstream-one',
			path: '/worktrees/malini-one',
			repositoryPath: '/repositories/malini',
			repositoryFullName: ' acme/web ',
		};
		const lifecycle = new TestLifecycle();
		const host = createHost({ storage, currentWorkstream: () => currentWorkstream });
		const api = host.createAPI(exampleManifest, lifecycle);
		for (const setting of exampleManifest.contributes!.settings!) api.settings.register(setting);

		await api.settings.set('acme.example.mode', 'manual');
		currentWorkstream = {
			...currentWorkstream,
			id: 'workstream-two',
			path: '/worktrees/malini-two',
			repositoryPath: '/different/local/malini-checkout',
			repositoryFullName: 'acme/web',
		};
		expect(api.settings.get('acme.example.mode')).toBe('manual');

		currentWorkstream = {
			...currentWorkstream,
			id: 'workstream-three',
			path: '/worktrees/other',
			repositoryPath: '/repositories/other',
			repositoryFullName: 'acme/other',
		};
		expect(api.settings.get('acme.example.mode')).toBe('smart');
		expect(storage.keys()).toEqual([
			extensionSettingStorageKey('acme.example', 'acme.example.mode', {
				kind: 'repository',
				id: 'acme/web',
			}),
		]);

		await lifecycle.disposeAll();
	});

	it('uses the stable repository root for local worktrees without a hosted identity', async () => {
		const storage = new MemorySettingStorage();
		let currentWorkstream: ExtensionWorkstream = {
			...workstream,
			id: 'local-one',
			path: '/worktrees/local-one',
			repositoryPath: '/worktrees/local-one',
			repositoryRootPath: '/repositories/local-malini',
		};
		const lifecycle = new TestLifecycle();
		const host = createHost({ storage, currentWorkstream: () => currentWorkstream });
		const api = host.createAPI(exampleManifest, lifecycle);
		for (const setting of exampleManifest.contributes!.settings!) api.settings.register(setting);

		await api.settings.set('acme.example.mode', 'manual');
		currentWorkstream = {
			...currentWorkstream,
			id: 'local-two',
			path: '/worktrees/local-two',
			repositoryPath: '/worktrees/local-two',
		};
		expect(api.settings.get('acme.example.mode')).toBe('manual');
		expect(storage.keys()).toEqual([
			extensionSettingStorageKey('acme.example', 'acme.example.mode', {
				kind: 'repository',
				id: '/repositories/local-malini',
			}),
		]);

		await lifecycle.disposeAll();
	});

	it('falls back to a manifest default when persisted settings are corrupt', () => {
		const storage = new MemorySettingStorage();
		const key = extensionSettingStorageKey('acme.example', 'acme.example.enabled', {
			kind: 'global',
		});
		storage.set(key, '{broken');
		const lifecycle = new TestLifecycle();
		const host = createHost({ storage });
		const api = host.createAPI(exampleManifest, lifecycle);
		api.settings.register(exampleManifest.contributes!.settings![1]!);

		expect(api.settings.get('acme.example.enabled')).toBe(true);
		expect(storage.get(key)).toBeNull();
	});

	it('delivers events across extensions, isolates listener failures, and disposes subscriptions', async () => {
		const firstLifecycle = new TestLifecycle();
		const secondLifecycle = new TestLifecycle();
		const host = createHost();
		const first = host.createAPI(exampleManifest, firstLifecycle);
		const second = host.createAPI(manifest('another.extension'), secondLifecycle);
		const received: string[] = [];
		first.events.on<{ value: string }>('malini.workstream.changed', ({ value }) => {
			received.push(`first:${value}`);
			throw new Error('listener failed');
		});
		second.events.on<{ value: string }>('malini.workstream.changed', ({ value }) => {
			received.push(`second:${value}`);
		});

		await expect(second.events.emit('malini.workstream.changed', { value: 'one' })).rejects.toThrow(
			'One or more listeners failed for extension event malini.workstream.changed',
		);
		expect(received).toEqual(['first:one', 'second:one']);

		await firstLifecycle.disposeAll();
		await second.events.emit('malini.workstream.changed', { value: 'two' });
		expect(received).toEqual(['first:one', 'second:one', 'second:two']);
		expect(() => first.events.on(' ', () => undefined)).toThrow(
			'Extension event name must not be empty',
		);
		await secondLifecycle.disposeAll();
	});
});

function panelContext(): ExtensionPanelContext {
	return {
		workstream,
		settings: {},
		executeCommand: () => {
			throw new Error('This panel context does not execute commands');
		},
	};
}

function manifest(id: string, contributes?: ExtensionManifest['contributes']): ExtensionManifest {
	return {
		schemaVersion: 1,
		id,
		name: id,
		version: '1.0.0',
		apiVersion: 1,
		description: `${id} extension`,
		publisher: id.split('.')[0] ?? id,
		entrypoint: './dist/index.js',
		activationEvents: ['onStartup'],
		...(contributes ? { contributes } : {}),
	};
}

function createHost(
	options: {
		panels?: InspectorPanelRegistry;
		storage?: ExtensionSettingStorage;
		currentWorkstream?: () => ExtensionWorkstream | null;
		openPanel?: (workstreamId: string, panelId: string) => void;
		openDocument?: (workstreamId: string, document: WorkstreamDocumentOpening) => void;
	} = {},
): DesktopExtensionContributionHost {
	return new DesktopExtensionContributionHost({
		panelRegistry: options.panels ?? new InspectorPanelRegistry(),
		settingStorage: options.storage ?? new MemorySettingStorage(),
		currentWorkstream: options.currentWorkstream ?? (() => workstream),
		...(options.openPanel ? { openPanel: options.openPanel } : {}),
		...(options.openDocument ? { openDocument: options.openDocument } : {}),
	});
}

class TestLifecycle implements ExtensionLifecycleScope {
	readonly #owned: ExtensionDisposable[] = [];

	track(disposable: ExtensionDisposable): ExtensionDisposable {
		this.#owned.push(disposable);
		return disposable;
	}

	async disposeAll(): Promise<void> {
		for (const owned of this.#owned.splice(0).reverse()) await owned.dispose();
	}
}

class MemorySettingStorage implements ExtensionSettingStorage {
	readonly #values = new Map<string, string>();

	get(key: string): string | null {
		return this.#values.get(key) ?? null;
	}

	set(key: string, value: string): void {
		this.#values.set(key, value);
	}

	delete(key: string): void {
		this.#values.delete(key);
	}

	keys(): readonly string[] {
		return [...this.#values.keys()];
	}
}
