import {
	EXTENSION_EVENTS,
	type ExtensionAPI,
	type ExtensionDisposable,
	type ExtensionWorkstream,
} from '@malini/extension-api';

import {
	compileWorkstreamAutomation,
	type CompiledWorkstreamAutomationTrigger,
	type WorkstreamAutomationEvent,
} from '$shared/extensions/compile-automation-trigger';

import type { WorkstreamCreatedAutomationContext } from '../../domain/workstream-created-automation-context';
import type { DesktopExtensionContributionHost } from '../host/contributions.adapter';
import type {
	WorkstreamExtensionAutomationRun,
	WorkstreamExtensionConfiguration,
	WorkstreamExtensionJsonValue,
	WorkstreamExtensionWorkflowRun,
} from '../../domain/workstream-extension-configuration';

type WorkstreamExtensionAutomationFailure = Readonly<{
	workstreamId: string;
	ruleId: string;
	message: string;
}>;

type ActiveRule = Readonly<{
	extensionId: string;
	id: string;
	when: string;
	run: WorkstreamExtensionAutomationRun;
	trigger: CompiledWorkstreamAutomationTrigger;
}>;

type ActiveRun = Readonly<{
	controller: AbortController;
	promise: Promise<void>;
}>;

const SETTLED_STATE_KEY = 'successful-runs-v1';

export class WorkstreamExtensionAutomationRuntime {
	readonly #contributions: DesktopExtensionContributionHost;
	readonly #workstream: () => ExtensionWorkstream | null;
	readonly #state: ExtensionAPI['state'];
	readonly #subscriptions: ExtensionDisposable[] = [];
	readonly #settled = new Set<string>();
	readonly #inFlight = new Map<string, ActiveRun>();
	readonly #announcements = new Set<Promise<void>>();
	#rules: ActiveRule[] = [];
	#failures: WorkstreamExtensionAutomationFailure[] = [];
	#generation = 0;

	constructor(input: {
		contributions: DesktopExtensionContributionHost;
		workstream: () => ExtensionWorkstream | null;
		state: ExtensionAPI['state'];
	}) {
		this.#contributions = input.contributions;
		this.#workstream = input.workstream;
		this.#state = input.state;
	}

	get failures(): readonly WorkstreamExtensionAutomationFailure[] {
		return this.#failures.map((failure) => ({ ...failure }));
	}

	get rules(): readonly Readonly<{
		extensionId: string;
		id: string;
		when: string;
		description: string;
	}>[] {
		return this.#rules.map(({ extensionId, id, when, trigger }) => ({
			extensionId,
			id,
			when,
			description: trigger.description,
		}));
	}

	async configure(configuration: WorkstreamExtensionConfiguration): Promise<void> {
		await this.suspend();
		this.#failures = [];
		this.#rules = [];
		this.#settled.clear();
		this.#rules = Object.entries(configuration.extensions).flatMap(([extensionId, entry]) => {
			if (!entry.enabled) return [];
			return entry.automations
				.filter(({ enabled }) => enabled)
				.map((rule): ActiveRule => ({
					extensionId,
					id: rule.id,
					when: rule.when,
					run: rule.run,
					trigger: compileWorkstreamAutomation(rule.when),
				}));
		});
		await this.#hydrateSettledRuns();
		const generation = this.#generation;
		const events = new Set(
			this.#rules.flatMap(({ trigger }) => (trigger.event === null ? [] : [trigger.event])),
		);
		for (const event of events) {
			this.#subscriptions.push(
				this.#contributions.onEvent(event, (payload) => this.#handle(generation, event, payload)),
			);
		}
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
				.map(({ id }) => id),
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
			if (this.#settled.has(key) || this.#inFlight.has(key)) continue;
			await this.#fire(generation, active, workstream, event, payload, key);
		}
	}

	async #fire(
		generation: number,
		active: ActiveRule,
		workstream: ExtensionWorkstream,
		event: WorkstreamAutomationEvent,
		payload: unknown,
		key: string,
	): Promise<void> {
		const controller = new AbortController();
		const promise = this.#runStep(active.run, workstream, event, payload, controller.signal);
		this.#inFlight.set(key, { controller, promise });
		try {
			await promise;
			if (generation !== this.#generation || controller.signal.aborted) return;
			this.#settled.add(key);
			await this.#persistSettledRuns(workstream.id);
			this.#clearFailure(workstream.id, active.id);
		} catch (error) {
			if (generation === this.#generation && !controller.signal.aborted) {
				this.#recordFailure(workstream.id, active.id, error);
			}
		} finally {
			if (this.#inFlight.get(key)?.promise === promise) this.#inFlight.delete(key);
		}
	}

	async #runStep(
		run: WorkstreamExtensionAutomationRun,
		workstream: ExtensionWorkstream,
		event: WorkstreamAutomationEvent,
		payload: unknown,
		signal: AbortSignal,
	): Promise<void> {
		if ('workflow' in run) {
			await this.#contributions.executeWorkflow(run.workflow, {
				workstream,
				input: workflowInput(run, event, payload),
				report() {},
				signal,
			});
		} else {
			await this.#contributions.executeCommand(run.command, ...run.args);
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
	input: WorkstreamExtensionWorkflowRun,
	event: WorkstreamAutomationEvent,
	payload: unknown,
): Readonly<Record<string, WorkstreamExtensionJsonValue>> {
	if (event === EXTENSION_EVENTS.resourceReady) {
		return {
			...input.input,
			...resourceReadyWorkflowContext(payload),
		};
	}
	if (
		event !== EXTENSION_EVENTS.workstreamCreated ||
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

function automationRunKey(workstreamId: string, active: ActiveRule, eventIdentity: string): string {
	return stableJson([
		workstreamId,
		active.extensionId,
		active.id,
		active.when,
		active.run,
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
