import { describe, expect, it, vi } from 'vitest';

import {
	EXTENSION_EVENTS,
	type ExtensionManifest,
	type ExtensionDisposable,
	type ExtensionWorkstream,
} from '@malini/extension-api';

import type { ExtensionSettingStorage } from '../../domain/extension-storage';
import { DesktopExtensionContributionHost } from '../host/contributions.adapter';
import { createDesktopExtensionState } from '../host/state.adapter';
import { parseWorkstreamExtensionConfiguration } from '../../domain/workstream-extension-configuration';
import {
	createMemoryRoutineGateStore,
	type WorkstreamRoutineGateStore,
} from '$shared/extensions/automation-gate';
import type { WorkstreamRoutineDefinition } from '$shared/extensions/automation-rules.store.svelte';
import { WorkstreamExtensionAutomationRuntime } from './extension-automation-runtime';

describe('workstream extension automation', () => {
	it('runs matching workflows once per resource and workstream', async () => {
		const workstream = fakeWorkstream('workstream-1');
		const storage = new MemoryStorage();
		const contributions = new DesktopExtensionContributionHost({
			currentWorkstream: () => workstream,
			settingStorage: storage,
		});
		const owned: ExtensionDisposable[] = [];
		const api = contributions.createAPI(manifest, {
			track(disposable) {
				owned.push(disposable);
				return disposable;
			},
		});
		const runs: string[] = [];
		api.workflows.register({
			id: 'example.preview.ensure-ready',
			label: 'Ensure ready',
			run: (context) => {
				runs.push(`${context.workstream.id}:${String(context.input.reason)}`);
			},
		});
		const runtime = new WorkstreamExtensionAutomationRuntime({
			contributions,
			workstream: () => workstream,
			state: automationState(storage),
		});
		await runtime.configure(
			parseWorkstreamExtensionConfiguration(
				JSON.stringify({
					schemaVersion: 1,
					extensions: {
						'example.preview': {
							enabled: true,
							automations: [
								{
									id: 'frontend-ready',
									when: 'when a frontend Docker container becomes ready',
									run: {
										workflow: 'example.preview.ensure-ready',
										input: { reason: 'frontend' },
									},
								},
							],
						},
					},
				}),
			),
		);

		const event = {
			workstreamId: workstream.id,
			resourceId: 'docker-frontend',
			kind: 'docker',
			state: 'ready',
			componentId: 'frontend-web',
		};
		await contributions.emit(EXTENSION_EVENTS.resourceReady, event);
		await contributions.emit(EXTENSION_EVENTS.resourceReady, event);
		await contributions.emit(EXTENSION_EVENTS.resourceReady, {
			...event,
			resourceId: 'docker-backend',
			componentId: 'backend-api',
		});
		expect(runs).toEqual(['workstream-1:frontend']);
		expect(runtime.failures).toEqual([]);

		await runtime.dispose();
		for (const disposable of owned.reverse()) await disposable.dispose();
	});

	it('merges only sanitized resource-ready fields into workflow input', async () => {
		const workstream = fakeWorkstream('workstream-process');
		const storage = new MemoryStorage();
		const contributions = new DesktopExtensionContributionHost({
			currentWorkstream: () => workstream,
			settingStorage: storage,
		});
		const owned: ExtensionDisposable[] = [];
		const api = contributions.createAPI(manifest, {
			track(disposable) {
				owned.push(disposable);
				return disposable;
			},
		});
		const inputs: Readonly<Record<string, unknown>>[] = [];
		api.workflows.register({
			id: 'example.preview.ensure-ready',
			label: 'Ensure ready',
			run: ({ input }) => {
				inputs.push(input);
			},
		});
		const runtime = new WorkstreamExtensionAutomationRuntime({
			contributions,
			workstream: () => workstream,
			state: automationState(storage),
		});
		await runtime.configure(
			parseWorkstreamExtensionConfiguration(
				JSON.stringify({
					schemaVersion: 1,
					extensions: {
						'example.preview': {
							enabled: true,
							automations: [
								{
									id: 'frontend-ready',
									when: 'when a frontend resource becomes ready',
									run: {
										workflow: 'example.preview.ensure-ready',
										input: {
											reason: 'configured',
											url: 'http://configured.invalid',
										},
									},
								},
							],
						},
					},
				}),
			),
		);

		const event: Record<string, unknown> = Object.assign(
			Object.create({
				id: 'inherited-id',
				command: 'inherited command',
				reasoning: 'inherited reasoning',
			}),
			{
				workstreamId: workstream.id,
				resourceId: ' process-frontend ',
				runtimeId: 'process-runtime',
				key: 'example.workstream-setup:process:workstream-process:frontend-web',
				kind: 'process',
				componentId: 'frontend-web',
				componentLabel: 'Frontend web',
				componentKind: 'frontend',
				name: 'Web application',
				owner: 'workstream',
				state: 'ready',
				health: 'healthy',
				url: ' http://127.0.0.1:4173 ',
				readyAt: 42,
				extra: { accessToken: 'must-not-cross-the-workflow-boundary' },
			},
		);
		await contributions.emit(EXTENSION_EVENTS.resourceReady, event);

		expect(inputs).toEqual([
			{
				reason: 'configured',
				url: 'http://127.0.0.1:4173',
				workstreamId: workstream.id,
				resourceId: 'process-frontend',
				runtimeId: 'process-runtime',
				key: 'example.workstream-setup:process:workstream-process:frontend-web',
				componentId: 'frontend-web',
				componentLabel: 'Frontend web',
				componentKind: 'frontend',
				name: 'Web application',
				kind: 'process',
				owner: 'workstream',
				state: 'ready',
				health: 'healthy',
				readyAt: 42,
			},
		]);
		expect(Object.hasOwn(inputs[0] ?? {}, 'extra')).toBe(false);
		expect(Object.hasOwn(inputs[0] ?? {}, 'id')).toBe(false);
		expect(Object.hasOwn(inputs[0] ?? {}, 'command')).toBe(false);
		expect(Object.hasOwn(inputs[0] ?? {}, 'reasoning')).toBe(false);

		await runtime.dispose();
		for (const disposable of owned.reverse()) await disposable.dispose();
	});

	it('passes external creation task context into a new-workstream workflow', async () => {
		const workstream = fakeWorkstream('workstream-linear');
		const storage = new MemoryStorage();
		const contributions = new DesktopExtensionContributionHost({
			currentWorkstream: () => workstream,
			settingStorage: storage,
		});
		const api = contributions.createAPI(manifest, { track: (disposable) => disposable });
		const inputs: Readonly<Record<string, unknown>>[] = [];
		api.workflows.register({
			id: 'example.preview.prepare',
			label: 'Prepare',
			run: ({ input }) => {
				inputs.push(input);
			},
		});
		const runtime = new WorkstreamExtensionAutomationRuntime({
			contributions,
			workstream: () => workstream,
			state: automationState(storage),
		});
		await runtime.configure(
			parseWorkstreamExtensionConfiguration(
				JSON.stringify({
					schemaVersion: 1,
					extensions: {
						'example.preview': {
							enabled: true,
							automations: [
								{
									id: 'prepare-created',
									when: 'when a new workstream is created',
									run: {
										workflow: 'example.preview.prepare',
										input: { task: 'generic fallback', preserve: 'configured' },
									},
								},
							],
						},
					},
				}),
			),
		);

		await runtime.announceWorkstreamCreated({
			task: 'Implement CUR-42 · Add billing controls',
			source: { provider: 'linear', resourceId: 'issue-42' },
		});

		expect(inputs).toEqual([
			{
				task: 'Implement CUR-42 · Add billing controls',
				preserve: 'configured',
				source: { provider: 'linear', resourceId: 'issue-42' },
			},
		]);
		await runtime.dispose();
	});

	it('allows a matching event to retry after a failed run and deduplicates only success', async () => {
		const workstream = fakeWorkstream('workstream-retry');
		const storage = new MemoryStorage();
		const contributions = new DesktopExtensionContributionHost({
			currentWorkstream: () => workstream,
			settingStorage: storage,
		});
		const owned: ExtensionDisposable[] = [];
		const api = contributions.createAPI(manifest, {
			track(disposable) {
				owned.push(disposable);
				return disposable;
			},
		});
		let attempts = 0;
		api.workflows.register({
			id: 'example.preview.ensure-ready',
			label: 'Ensure ready',
			run: () => {
				attempts += 1;
				if (attempts === 1) throw new Error('preview was not ready');
			},
		});
		const runtime = new WorkstreamExtensionAutomationRuntime({
			contributions,
			workstream: () => workstream,
			state: automationState(storage),
		});
		await runtime.configure(frontendAutomationConfiguration());
		const event = frontendReadyEvent(workstream.id);

		await contributions.emit(EXTENSION_EVENTS.resourceReady, event);
		expect(attempts).toBe(1);
		expect(runtime.failures).toEqual([
			{
				workstreamId: workstream.id,
				ruleId: 'frontend-ready',
				message: 'preview was not ready',
			},
		]);

		await contributions.emit(EXTENSION_EVENTS.resourceReady, event);
		await contributions.emit(EXTENSION_EVENTS.resourceReady, event);
		expect(attempts).toBe(2);
		expect(runtime.failures).toEqual([]);

		await runtime.dispose();
		for (const disposable of owned.reverse()) await disposable.dispose();
	});

	it('aborts and awaits an in-flight workflow before reconfiguring listeners', async () => {
		const workstream = fakeWorkstream('workstream-abort');
		const storage = new MemoryStorage();
		const contributions = new DesktopExtensionContributionHost({
			currentWorkstream: () => workstream,
			settingStorage: storage,
		});
		const owned: ExtensionDisposable[] = [];
		const api = contributions.createAPI(manifest, {
			track(disposable) {
				owned.push(disposable);
				return disposable;
			},
		});
		let markStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		let aborted = false;
		api.workflows.register({
			id: 'example.preview.ensure-ready',
			label: 'Ensure ready',
			run: ({ signal }) =>
				new Promise<void>((_resolve, reject) => {
					markStarted();
					signal.addEventListener(
						'abort',
						() => {
							aborted = true;
							reject(new Error('automation aborted'));
						},
						{ once: true },
					);
				}),
		});
		const runtime = new WorkstreamExtensionAutomationRuntime({
			contributions,
			workstream: () => workstream,
			state: automationState(storage),
		});
		await runtime.configure(frontendAutomationConfiguration());
		const emission = contributions.emit(
			EXTENSION_EVENTS.resourceReady,
			frontendReadyEvent(workstream.id),
		);
		await started;

		await runtime.configure(emptyConfiguration());
		await emission;
		expect(aborted).toBe(true);
		expect(runtime.failures).toEqual([]);
		expect(runtime.rules).toEqual([]);

		await runtime.dispose();
		for (const disposable of owned.reverse()) await disposable.dispose();
	});

	it('remembers successful workstream automation across runtime recreation', async () => {
		const workstream = fakeWorkstream('workstream-persisted');
		const storage = new MemoryStorage();
		const contributions = new DesktopExtensionContributionHost({
			currentWorkstream: () => workstream,
			settingStorage: storage,
		});
		const owned: ExtensionDisposable[] = [];
		const api = contributions.createAPI(manifest, {
			track(disposable) {
				owned.push(disposable);
				return disposable;
			},
		});
		let runs = 0;
		api.workflows.register({
			id: 'example.preview.ensure-ready',
			label: 'Ensure ready',
			run: () => {
				runs += 1;
			},
		});
		const configuration = frontendAutomationConfiguration();
		const event = frontendReadyEvent(workstream.id);

		const first = new WorkstreamExtensionAutomationRuntime({
			contributions,
			workstream: () => workstream,
			state: automationState(storage),
		});
		await first.configure(configuration);
		await contributions.emit(EXTENSION_EVENTS.resourceReady, event);
		await first.dispose();

		const reloaded = new WorkstreamExtensionAutomationRuntime({
			contributions,
			workstream: () => workstream,
			state: automationState(storage),
		});
		await reloaded.configure(configuration);
		await contributions.emit(EXTENSION_EVENTS.resourceReady, event);
		expect(runs).toBe(1);

		await reloaded.dispose();
		for (const disposable of owned.reverse()) await disposable.dispose();
	});
});

describe('workstream routines in the automation runtime', () => {
	type Harness = {
		workstream: ExtensionWorkstream;
		storage: MemoryStorage;
		contributions: DesktopExtensionContributionHost;
		runs: unknown[];
		owned: ExtensionDisposable[];
		makeRuntime(gate?: WorkstreamRoutineGateStore): WorkstreamExtensionAutomationRuntime;
	};

	function harness(workstreamId: string): Harness {
		const workstream = fakeWorkstream(workstreamId);
		const storage = new MemoryStorage();
		const contributions = new DesktopExtensionContributionHost({
			currentWorkstream: () => workstream,
			settingStorage: storage,
		});
		const owned: ExtensionDisposable[] = [];
		const api = contributions.createAPI(manifest, {
			track(disposable) {
				owned.push(disposable);
				return disposable;
			},
		});
		const runs: unknown[] = [];
		api.workflows.register({
			id: 'example.preview.ensure-ready',
			label: 'Ensure ready',
			run: ({ input }) => {
				runs.push(input);
			},
		});
		return {
			workstream,
			storage,
			contributions,
			runs,
			owned,
			makeRuntime: (gate) =>
				new WorkstreamExtensionAutomationRuntime({
					contributions,
					workstream: () => workstream,
					state: automationState(storage),
					...(gate !== undefined ? { gate } : {}),
				}),
		};
	}

	function routineDefinition(
		overrides: Partial<WorkstreamRoutineDefinition> = {},
	): WorkstreamRoutineDefinition {
		return {
			id: 'routine-frontend-preview',
			status: 'routine',
			origin: 'user',
			label: 'Ensure the preview is ready',
			when: 'when a frontend Docker container becomes ready',
			run: { workflow: 'example.preview.ensure-ready', input: { reason: 'routine' } },
			evidence: [{ kind: 'prompt', text: 'open the preview when the frontend boots' }],
			...overrides,
		};
	}

	async function drain(h: Harness): Promise<void> {
		for (const disposable of h.owned.reverse()) await disposable.dispose();
	}

	it('never subscribes a draft', async () => {
		const h = harness('workstream-draft');
		const runtime = h.makeRuntime();
		const onEvent = vi.spyOn(h.contributions, 'onEvent');
		await runtime.configure(emptyConfiguration(), [routineDefinition({ status: 'draft' })]);

		expect(onEvent).not.toHaveBeenCalled();
		expect(runtime.rules).toEqual([]);
		await h.contributions.emit(EXTENSION_EVENTS.resourceReady, frontendReadyEvent(h.workstream.id));
		expect(h.runs).toEqual([]);
		expect(runtime.pendingGatedRuns).toEqual([]);
		expect(runtime.failures).toEqual([]);
		await runtime.dispose();
		await drain(h);
	});

	it('runs a routine-status routine unattended, once per occurrence', async () => {
		const h = harness('workstream-routine');
		const runtime = h.makeRuntime();
		await runtime.configure(emptyConfiguration(), [routineDefinition({ status: 'routine' })]);
		expect(runtime.rules.map(({ id, status }) => ({ id, status }))).toEqual([
			{ id: 'routine-frontend-preview', status: 'routine' },
		]);

		const event = frontendReadyEvent(h.workstream.id);
		await h.contributions.emit(EXTENSION_EVENTS.resourceReady, event);
		await h.contributions.emit(EXTENSION_EVENTS.resourceReady, event);
		expect(h.runs).toHaveLength(1);
		expect(runtime.pendingGatedRuns).toEqual([]);
		await runtime.dispose();
		await drain(h);
	});

	it('halts a candidate at the confirmation gate until it is confirmed', async () => {
		const h = harness('workstream-candidate');
		const gate = createMemoryRoutineGateStore();
		const runtime = h.makeRuntime(gate);
		await runtime.configure(emptyConfiguration(), [routineDefinition({ status: 'candidate' })]);

		const event = frontendReadyEvent(h.workstream.id);
		await h.contributions.emit(EXTENSION_EVENTS.resourceReady, event);
		expect(h.runs).toEqual([]);
		expect(runtime.failures).toEqual([]);
		const pending = runtime.pendingGatedRuns;
		expect(pending).toHaveLength(1);
		const held = pending[0];
		expect(held?.routineId).toBe('routine-frontend-preview');
		expect(held?.state).toBe('pending');
		expect(await gate.listPending(h.workstream.id)).toHaveLength(1);

		await h.contributions.emit(EXTENSION_EVENTS.resourceReady, event);
		expect(runtime.pendingGatedRuns).toHaveLength(1);

		await runtime.confirmGatedRun(held?.id ?? '');
		expect(h.runs).toEqual([{ reason: 'routine', ...event }]);
		expect(runtime.pendingGatedRuns).toEqual([]);
		expect(gate.records.get(held?.id ?? '')?.state).toBe('confirmed');

		await h.contributions.emit(EXTENSION_EVENTS.resourceReady, event);
		expect(h.runs).toHaveLength(1);
		expect(runtime.pendingGatedRuns).toEqual([]);
		await runtime.dispose();
		await drain(h);
	});

	it('discards a rejected candidate run and never re-gates the occurrence', async () => {
		const h = harness('workstream-reject');
		const gate = createMemoryRoutineGateStore();
		const runtime = h.makeRuntime(gate);
		await runtime.configure(emptyConfiguration(), [routineDefinition({ status: 'candidate' })]);

		const event = frontendReadyEvent(h.workstream.id);
		await h.contributions.emit(EXTENSION_EVENTS.resourceReady, event);
		const held = runtime.pendingGatedRuns[0];
		expect(held).toBeDefined();

		await runtime.rejectGatedRun(held?.id ?? '');
		expect(h.runs).toEqual([]);
		expect(runtime.pendingGatedRuns).toEqual([]);
		expect(gate.records.get(held?.id ?? '')?.state).toBe('rejected');

		await h.contributions.emit(EXTENSION_EVENTS.resourceReady, event);
		expect(h.runs).toEqual([]);
		expect(runtime.pendingGatedRuns).toEqual([]);
		await runtime.dispose();
		await drain(h);
	});

	it('re-holds persisted pending runs after a reload so a confirmation still executes', async () => {
		const h = harness('workstream-rehold');
		const gate = createMemoryRoutineGateStore();
		const routines = [routineDefinition({ status: 'candidate' })];

		const first = h.makeRuntime(gate);
		await first.configure(emptyConfiguration(), routines);
		await h.contributions.emit(EXTENSION_EVENTS.resourceReady, frontendReadyEvent(h.workstream.id));
		const heldId = first.pendingGatedRuns[0]?.id;
		expect(heldId).toBeDefined();
		await first.dispose();

		const reloaded = h.makeRuntime(gate);
		await reloaded.configure(emptyConfiguration(), routines);
		expect(reloaded.pendingGatedRuns.map(({ id }) => id)).toEqual([heldId]);
		await reloaded.confirmGatedRun(heldId ?? '');
		expect(h.runs).toHaveLength(1);
		await reloaded.dispose();
		await drain(h);
	});

	it('rejects an orphaned pending run whose candidate no longer exists', async () => {
		const h = harness('workstream-orphan');
		const gate = createMemoryRoutineGateStore();

		const first = h.makeRuntime(gate);
		await first.configure(emptyConfiguration(), [routineDefinition({ status: 'candidate' })]);
		await h.contributions.emit(EXTENSION_EVENTS.resourceReady, frontendReadyEvent(h.workstream.id));
		const heldId = first.pendingGatedRuns[0]?.id;
		expect(heldId).toBeDefined();
		await first.dispose();

		const reloaded = h.makeRuntime(gate);
		await reloaded.configure(emptyConfiguration(), [routineDefinition({ status: 'draft' })]);
		expect(reloaded.pendingGatedRuns).toEqual([]);
		expect(gate.records.get(heldId ?? '')?.state).toBe('rejected');
		await reloaded.dispose();
		await drain(h);
	});

	it('records a failure instead of breaking configure for an uncompilable routine', async () => {
		const h = harness('workstream-broken');
		const runtime = h.makeRuntime();
		await runtime.configure(emptyConfiguration(), [
			routineDefinition({ id: 'routine-broken', when: 'whenever it feels useful' }),
		]);
		expect(runtime.rules).toEqual([]);
		expect(runtime.failures).toEqual([
			{
				workstreamId: h.workstream.id,
				ruleId: 'routine-broken',
				message: expect.stringContaining('Unsupported extension automation trigger') as string,
			},
		]);
		await runtime.dispose();
		await drain(h);
	});
});

const manifest: ExtensionManifest = {
	schemaVersion: 1,
	id: 'example.preview',
	name: 'Preview',
	version: '1.0.0',
	apiVersion: 1,
	description: 'Preview automation test',
	publisher: 'malini',
	entrypoint: './index.js',
	activationEvents: ['onWorkstream'],
	contributes: {
		workflows: [
			{ id: 'example.preview.ensure-ready', label: 'Ensure ready' },
			{ id: 'example.preview.prepare', label: 'Prepare' },
		],
	},
};

function fakeWorkstream(id: string): ExtensionWorkstream {
	return {
		id,
		path: `/tmp/${id}`,
		repositoryPath: `/tmp/${id}`,
		branch: `malini/${id}`,
		baseBranch: 'main',
	};
}

function frontendAutomationConfiguration() {
	return parseWorkstreamExtensionConfiguration(
		JSON.stringify({
			schemaVersion: 1,
			extensions: {
				'example.preview': {
					enabled: true,
					automations: [
						{
							id: 'frontend-ready',
							when: 'when a frontend Docker container becomes ready',
							run: {
								workflow: 'example.preview.ensure-ready',
								input: { reason: 'frontend' },
							},
						},
					],
				},
			},
		}),
	);
}

function emptyConfiguration() {
	return parseWorkstreamExtensionConfiguration(
		JSON.stringify({ schemaVersion: 1, extensions: {} }),
	);
}

function frontendReadyEvent(workstreamId: string) {
	return {
		workstreamId,
		resourceId: 'docker-frontend',
		kind: 'docker',
		state: 'ready',
		componentId: 'frontend-web',
	};
}

function automationState(storage: MemoryStorage) {
	return createDesktopExtensionState({
		extensionId: 'malini.workstream-automation-runtime',
		storage,
	});
}

class MemoryStorage implements ExtensionSettingStorage {
	readonly #values = new Map<string, string>();
	get(key: string): string | null {
		return this.getItem(key);
	}
	set(key: string, value: string): void {
		this.setItem(key, value);
	}
	delete(key: string): void {
		this.removeItem(key);
	}
	getItem(key: string): string | null {
		return this.#values.get(key) ?? null;
	}
	setItem(key: string, value: string): void {
		this.#values.set(key, value);
	}
	removeItem(key: string): void {
		this.#values.delete(key);
	}
}
