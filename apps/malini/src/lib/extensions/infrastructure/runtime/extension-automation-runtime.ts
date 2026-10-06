import {
	EXTENSION_EVENTS,
	type ExtensionAPI,
	type ExtensionDisposable,
	type ExtensionWorkstream,
} from '@malini/extension-api';

import type { RoutineGatedRunRecord, RoutineStatus } from '$contract/routines';
import {
	createMemoryRoutineGateStore,
	type WorkstreamRoutineGateStore,
} from '$shared/extensions/automation-gate';
import type { WorkstreamRoutineDefinition } from '$shared/extensions/automation-rules.store.svelte';
import {
	compileWorkstreamAutomation,
	type CompiledWorkstreamAutomationTrigger,
	type WorkstreamAutomationEvent,
} from '$shared/extensions/compile-automation-trigger';

import type { WorkstreamCreatedAutomationContext } from '../../domain/workstream-created-automation-context';
import type { DesktopExtensionContributionHost } from '../host/contributions.adapter';
import type {
	WorkstreamExtensionAutomationRule,
	WorkstreamExtensionConfiguration,
	WorkstreamExtensionJsonValue,
} from '../../domain/workstream-extension-configuration';

type WorkstreamExtensionAutomationFailure = Readonly<{
	workstreamId: string;
	ruleId: string;
	message: string;
}>;

type ActiveRule = Readonly<{
	extensionId: string;
	rule: WorkstreamExtensionAutomationRule;
	trigger: CompiledWorkstreamAutomationTrigger;
	status: RoutineStatus;
}>;

type ActiveRun = Readonly<{
	controller: AbortController;
	generation: number;
	promise: Promise<void>;
}>;

type HeldGatedRun = Readonly<{
	record: RoutineGatedRunRecord;
	active: ActiveRule;
}>;

const SETTLED_STATE_KEY = 'successful-runs-v1';

const ROUTINE_EXTENSION_ID = 'malini.routines';

export class WorkstreamExtensionAutomationRuntime {
	readonly #contributions: DesktopExtensionContributionHost;
	readonly #workstream: () => ExtensionWorkstream | null;
	readonly #state: ExtensionAPI['state'];
	readonly #gate: WorkstreamRoutineGateStore;
	readonly #subscriptions: ExtensionDisposable[] = [];
	readonly #settled = new Set<string>();
	readonly #inFlight = new Map<string, ActiveRun>();
	readonly #announcements = new Set<Promise<void>>();
	readonly #held = new Map<string, HeldGatedRun>();
	#rules: ActiveRule[] = [];
	#failures: WorkstreamExtensionAutomationFailure[] = [];
	#generation = 0;

	constructor(input: {
		contributions: DesktopExtensionContributionHost;
		workstream: () => ExtensionWorkstream | null;
		state: ExtensionAPI['state'];
		gate?: WorkstreamRoutineGateStore;
	}) {
		this.#contributions = input.contributions;
		this.#workstream = input.workstream;
		this.#state = input.state;
		this.#gate = input.gate ?? createMemoryRoutineGateStore();
	}

	get failures(): readonly WorkstreamExtensionAutomationFailure[] {
		return this.#failures.map((failure) => ({ ...failure }));
	}

	get rules(): readonly Readonly<{
		extensionId: string;
		id: string;
		when: string;
		description: string;
		status: RoutineStatus;
	}>[] {
		return this.#rules.map(({ extensionId, rule, trigger, status }) => ({
			extensionId,
			id: rule.id,
			when: rule.when,
			description: trigger.description,
			status,
		}));
	}

	get pendingGatedRuns(): readonly RoutineGatedRunRecord[] {
		return [...this.#held.values()].map(({ record }) => ({ ...record }));
	}

	async configure(
		configuration: WorkstreamExtensionConfiguration,
		routines: readonly WorkstreamRoutineDefinition[] = [],
	): Promise<void> {
		await this.suspend();
		this.#failures = [];
		this.#rules = [];
		this.#settled.clear();
		this.#held.clear();
		const rules: ActiveRule[] = Object.entries(configuration.extensions).flatMap(
			([extensionId, entry]) => {
				if (!entry.enabled) return [];
				return entry.automations
					.filter(({ enabled }) => enabled)
					.map((rule): ActiveRule => ({
						extensionId,
						rule,
						trigger: compileWorkstreamAutomation(rule.when),
						status: 'routine',
					}));
			},
		);
		for (const routine of routines) {
			if (routine.status === 'draft') continue;
			try {
				rules.push({
					extensionId: ROUTINE_EXTENSION_ID,
					rule: { id: routine.id, enabled: true, when: routine.when, run: routine.run },
					trigger: compileWorkstreamAutomation(routine.when),
					status: routine.status,
				});
			} catch (error) {
				const workstream = this.#workstream();
				if (workstream) this.#recordFailure(workstream.id, routine.id, error);
			}
		}
		this.#rules = rules;
		await this.#hydrateSettledRuns();
		await this.#hydrateGatedRuns();
		const generation = this.#generation;
		for (const event of new Set(this.#rules.map(({ trigger }) => trigger.event))) {
			this.#subscriptions.push(
				this.#contributions.onEvent(event, (payload) => this.#handle(generation, event, payload)),
			);
		}
	}

	async confirmGatedRun(gatedRunId: string): Promise<void> {
		const held = this.#requireHeld(gatedRunId);
		const workstream = this.#workstream();
		if (!workstream || workstream.id !== held.record.workstreamId) {
			throw new Error(`gated run \`${gatedRunId}\` belongs to an inactive workstream`);
		}
		const key = held.record.runKey;
		if (this.#settled.has(key) || this.#inFlight.has(key)) return;
		const generation = this.#generation;
		const controller = new AbortController();
		const promise = this.#run(held.active, workstream, held.record.payload, controller.signal);
		this.#inFlight.set(key, { controller, generation, promise });
		try {
			await promise;
			if (generation === this.#generation && !controller.signal.aborted) {
				this.#held.delete(gatedRunId);
				this.#settled.add(key);
				await this.#persistSettledRuns(workstream.id);
				await this.#gate.settle(gatedRunId, 'confirmed');
				this.#clearFailure(workstream.id, held.active.rule.id);
			}
		} catch (error) {
			if (generation === this.#generation && !controller.signal.aborted) {
				this.#recordFailure(workstream.id, held.active.rule.id, error);
			}
			throw asError(error);
		} finally {
			if (this.#inFlight.get(key)?.promise === promise) this.#inFlight.delete(key);
		}
	}

	async rejectGatedRun(gatedRunId: string): Promise<void> {
		const held = this.#requireHeld(gatedRunId);
		this.#held.delete(gatedRunId);
		this.#settled.add(held.record.runKey);
		await this.#persistSettledRuns(held.record.workstreamId);
		await this.#gate.settle(gatedRunId, 'rejected');
	}

	async suspend(): Promise<void> {
		this.#generation += 1;
		const failures: Error[] = [];
		try {
			await this.#clearSubscriptions();
		} catch (error) {
			failures.push(asError(error));
		}
		const runs = [...this.#inFlight.values()];
		for (const { controller } of runs) controller.abort();
		const results = await Promise.allSettled(runs.map(({ promise }) => promise));
		for (const [index, result] of results.entries()) {
			if (result.status === 'rejected' && !runs[index]?.controller.signal.aborted) {
				failures.push(asError(result.reason));
			}
		}
		await Promise.allSettled([...this.#announcements]);
		if (failures.length > 0) {
			throw new AggregateError(failures, 'Workstream extension automations failed to suspend');
		}
	}

	async announceWorkstreamCreated(context: WorkstreamCreatedAutomationContext = {}): Promise<void> {
		const workstream = this.#workstream();
		if (!workstream) return;
		const generation = this.#generation;
		const announcement = this.#contributions
			.emit(EXTENSION_EVENTS.workstreamCreated, {
				workstreamId: workstream.id,
				created: true,
				...context,
			})
			.catch((error) => {
				if (generation === this.#generation) {
					this.#recordFailure(workstream.id, 'malini.workstream-announcement', error);
				}
				throw error;
			});
		this.#announcements.add(announcement);
		try {
			await announcement;
		} finally {
			this.#announcements.delete(announcement);
		}
		const creationRuleIds = new Set(
			this.#rules
				.filter(({ trigger }) => trigger.event === EXTENSION_EVENTS.workstreamCreated)
				.map(({ rule }) => rule.id),
		);
		const failures = this.#failures.filter(
			(failure) => failure.workstreamId === workstream.id && creationRuleIds.has(failure.ruleId),
		);
		if (failures.length > 0) {
			throw new AggregateError(
				failures.map(({ message }) => new Error(message)),
				`New-workstream automations failed for ${workstream.id}`,
			);
		}
	}

	async dispose(): Promise<void> {
		try {
			await this.suspend();
		} finally {
			this.#rules = [];
			this.#failures = [];
			this.#settled.clear();
			this.#inFlight.clear();
			this.#announcements.clear();
			this.#held.clear();
		}
	}

	async #handle(
		generation: number,
		event: WorkstreamAutomationEvent,
		payload: unknown,
	): Promise<void> {
		if (generation !== this.#generation) return;
		const workstream = this.#workstream();
		if (!workstream || payloadWorkstreamId(payload) !== workstream.id) return;
		for (const active of this.#rules) {
			if (generation !== this.#generation) return;
			if (active.trigger.event !== event || !active.trigger.matches(payload)) continue;
			const identity = eventIdentity(event, payload);
			const key = automationRunKey(workstream.id, active, identity);
			if (this.#settled.has(key) || this.#inFlight.has(key) || this.#hasHeldKey(key)) continue;
			if (active.status === 'candidate') {
				await this.#holdCandidate(generation, active, workstream, event, payload, key);
				continue;
			}
			const controller = new AbortController();
			const promise = this.#run(active, workstream, payload, controller.signal);
			this.#inFlight.set(key, { controller, generation, promise });
			try {
				await promise;
				if (generation === this.#generation && !controller.signal.aborted) {
					this.#settled.add(key);
					await this.#persistSettledRuns(workstream.id);
					this.#clearFailure(workstream.id, active.rule.id);
				}
			} catch (error) {
				if (generation === this.#generation && !controller.signal.aborted) {
					this.#recordFailure(workstream.id, active.rule.id, error);
				}
			} finally {
				if (this.#inFlight.get(key)?.promise === promise) this.#inFlight.delete(key);
			}
		}
	}

	async #holdCandidate(
		generation: number,
		active: ActiveRule,
		workstream: ExtensionWorkstream,
		event: WorkstreamAutomationEvent,
		payload: unknown,
		key: string,
	): Promise<void> {
		try {
			const stored = await this.#gate.hold({
				id: randomGatedRunId(),
				routineId: active.rule.id,
				workstreamId: workstream.id,
				runKey: key,
				event,
				payload: asJsonValue(payload),
				state: 'pending',
				createdAt: new Date().toISOString(),
				decidedAt: null,
			});
			if (generation !== this.#generation) return;
			if (stored.state === 'pending') this.#held.set(stored.id, { record: stored, active });
			else this.#settled.add(key);
		} catch (error) {
			if (generation === this.#generation) {
				this.#recordFailure(workstream.id, active.rule.id, error);
			}
		}
	}

	#hasHeldKey(key: string): boolean {
		for (const { record } of this.#held.values()) if (record.runKey === key) return true;
		return false;
	}

	#requireHeld(gatedRunId: string): HeldGatedRun {
		const held = this.#held.get(gatedRunId);
		if (!held) throw new Error(`gated run \`${gatedRunId}\` is not held for this workstream`);
		return held;
	}

	async #hydrateGatedRuns(): Promise<void> {
		const workstream = this.#workstream();
		if (!workstream) return;
		const generation = this.#generation;
		const pending = await this.#gate.listPending(workstream.id);
		if (generation !== this.#generation) return;
		for (const record of pending) {
			const active = this.#rules.find(
				(candidate) => candidate.status === 'candidate' && candidate.rule.id === record.routineId,
			);
			if (active) this.#held.set(record.id, { record, active });
			else await this.#gate.settle(record.id, 'rejected');
		}
	}

	async #hydrateSettledRuns(): Promise<void> {
		const workstream = this.#workstream();
		if (!workstream) return;
		const persisted = await this.#state.get(SETTLED_STATE_KEY, {
			kind: 'workstream',
			id: workstream.id,
		});
		if (!Array.isArray(persisted)) return;
		for (const key of persisted) {
			if (typeof key === 'string' && key.length > 0) this.#settled.add(key);
		}
	}

	async #persistSettledRuns(workstreamId: string): Promise<void> {
		await this.#state.set(SETTLED_STATE_KEY, [...this.#settled].sort(), {
			kind: 'workstream',
			id: workstreamId,
		});
	}

	async #run(
		active: ActiveRule,
		workstream: ExtensionWorkstream,
		payload: unknown,
		signal: AbortSignal,
	): Promise<void> {
		if ('workflow' in active.rule.run) {
			await this.#contributions.executeWorkflow(active.rule.run.workflow, {
				workstream,
				input: workflowInput(active, payload),
				report() {},
				signal,
			});
			return;
		}
		await this.#contributions.executeCommand(active.rule.run.command, ...active.rule.run.args);
	}

	#recordFailure(workstreamId: string, ruleId: string, error: unknown): void {
		this.#failures = [
			...this.#failures.filter(
				(failure) => failure.workstreamId !== workstreamId || failure.ruleId !== ruleId,
			),
			{
				workstreamId,
				ruleId,
				message: error instanceof Error ? error.message : String(error),
			},
		];
	}

	#clearFailure(workstreamId: string, ruleId: string): void {
		this.#failures = this.#failures.filter(
			(failure) => failure.workstreamId !== workstreamId || failure.ruleId !== ruleId,
		);
	}

	async #clearSubscriptions(): Promise<void> {
		const failures: Error[] = [];
		for (const subscription of this.#subscriptions.splice(0).reverse()) {
			try {
				await subscription.dispose();
			} catch (error) {
				failures.push(asError(error));
			}
		}
		if (failures.length > 0) {
			throw new AggregateError(
				failures,
				'Workstream extension automation listeners failed to stop',
			);
		}
	}
}

function workflowInput(
	active: ActiveRule,
	payload: unknown,
): Readonly<Record<string, WorkstreamExtensionJsonValue>> {
	const input = active.rule.run;
	if (!('workflow' in input)) return {};
	if (active.trigger.event === EXTENSION_EVENTS.resourceReady) {
		return {
			...input.input,
			...resourceReadyWorkflowContext(payload),
		};
	}
	if (
		active.trigger.event !== EXTENSION_EVENTS.workstreamCreated ||
		!isRecord(payload) ||
		typeof payload.task !== 'string' ||
		!payload.task.trim()
	)
		return input.input;
	const source = workflowSource(payload.source);
	return {
		...input.input,
		task: payload.task.trim(),
		...(source ? { source } : {}),
	};
}

const RESOURCE_READY_STRING_FIELDS = [
	'workstreamId',
	'id',
	'resourceId',
	'runtimeId',
	'key',
	'componentId',
	'componentLabel',
	'componentKind',
	'name',
	'reasoning',
] as const;

function resourceReadyWorkflowContext(
	value: unknown,
): Readonly<Record<string, WorkstreamExtensionJsonValue>> {
	if (!isRecord(value)) return {};
	const context: Record<string, WorkstreamExtensionJsonValue> = {};
	for (const field of RESOURCE_READY_STRING_FIELDS) {
		const sanitized = trimmedOwnString(value, field);
		if (sanitized) context[field] = sanitized;
	}
	const kind = ownDataProperty(value, 'kind');
	if (kind === 'process' || kind === 'docker') context.kind = kind;
	const owner = ownDataProperty(value, 'owner');
	if (owner === 'workstream' || owner === 'shared') context.owner = owner;
	const state = ownDataProperty(value, 'state');
	if (state === 'ready') context.state = state;
	const health = ownDataProperty(value, 'health');
	if (health === 'healthy' || health === 'unhealthy' || health === 'unknown') {
		context.health = health;
	}
	for (const field of ['url', 'command'] as const) {
		const raw = ownDataProperty(value, field);
		if (raw === null) context[field] = null;
		else if (typeof raw === 'string' && raw.trim()) context[field] = raw.trim();
	}
	const readyAt = ownDataProperty(value, 'readyAt');
	if (typeof readyAt === 'number' && Number.isFinite(readyAt)) context.readyAt = readyAt;
	return context;
}

function workflowSource(value: unknown): WorkstreamExtensionJsonValue | null {
	if (
		!isRecord(value) ||
		typeof value.provider !== 'string' ||
		!value.provider.trim() ||
		typeof value.resourceId !== 'string' ||
		!value.resourceId.trim()
	) {
		return null;
	}
	return {
		provider: value.provider.trim(),
		resourceId: value.resourceId.trim(),
		...(typeof value.title === 'string' && value.title.trim() ? { title: value.title.trim() } : {}),
		...(typeof value.url === 'string' && value.url.trim() ? { url: value.url.trim() } : {}),
	};
}

function ownDataProperty(value: Record<string, unknown>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function trimmedOwnString(value: Record<string, unknown>, key: string): string | null {
	const candidate = ownDataProperty(value, key);
	return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

function payloadWorkstreamId(payload: unknown): string | null {
	return isRecord(payload) && typeof payload.workstreamId === 'string'
		? payload.workstreamId
		: null;
}

function eventIdentity(event: WorkstreamAutomationEvent, payload: unknown): string {
	if (!isRecord(payload)) return event;
	if (event === EXTENSION_EVENTS.workstreamCreated) {
		return typeof payload.workstreamId === 'string' ? payload.workstreamId : event;
	}
	for (const key of ['resourceId', 'runtimeId', 'key', 'componentId']) {
		if (typeof payload[key] === 'string' && payload[key].trim()) return payload[key];
	}
	return JSON.stringify(payload);
}

function randomGatedRunId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `gated-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function asJsonValue(payload: unknown): RoutineGatedRunRecord['payload'] {
	if (payload === undefined) return null;
	const serialized: unknown = JSON.parse(JSON.stringify(payload));
	return parseRoutineJsonValue(serialized);
}

function parseRoutineJsonValue(value: unknown): RoutineGatedRunRecord['payload'] {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') return value;
	if (Array.isArray(value)) return value.map(parseRoutineJsonValue);
	if (isRecord(value)) {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [key, parseRoutineJsonValue(entry)]),
		);
	}
	throw new Error('Routine gated run payload must be a JSON value');
}

function automationRunKey(workstreamId: string, active: ActiveRule, eventIdentity: string): string {
	return stableJson([
		workstreamId,
		active.extensionId,
		active.rule.id,
		active.rule.when,
		active.rule.run,
		eventIdentity,
	]);
}

function stableJson(value: unknown): string {
	return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJson);
	if (!isRecord(value)) return value;
	return Object.fromEntries(
		Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => [key, sortJson(entry)]),
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
