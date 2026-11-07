import {
	parseAutomationTrigger,
	type AutomationEventCondition,
	type ParsedTrigger,
} from '$contract/automation-trigger';
import { eventFacts } from '$contract/event-catalog';
import {
	AUTOMATIONS_DEFINITION_CHANGED_CHANNEL,
	AUTOMATIONS_RUN_CHANGED_CHANNEL,
	AUTOMATIONS_RUN_FINISHED_CHANNEL,
	AUTOMATIONS_RUN_STARTED_CHANNEL,
	type EventChannel,
} from '$contract/events';
import type {
	AutomationDefinitionRecord,
	AutomationRunMode,
	AutomationRunRecord,
} from '$contract/automations';
import type { MainContext } from '$main/context';
import { isRecord } from '$main/db/rows';
import { describeError } from '$main/errors';
import { getWorkstream } from '$shared/repositories/repositories.platform';
import type { ShippingRule } from '../automations.platform';
import { AUTOMATION_CHAIN_MAX_DEPTH, truncateAutomationContext } from '../domain/automation-run';
import { triggeredBefore } from './event-log.repository';
import { findString, type DispatchedEvent } from './event-log.service';
import { listAutomationDefinitions } from './automation-definitions.repository';
import { automationRunChainDefinitionIds } from './automation-runs.repository';

type EventTrigger = Extract<ParsedTrigger, { kind: 'event' }>;

type ArmedAutomation = Readonly<{
	definition: AutomationDefinitionRecord;
	mode: Exclude<AutomationRunMode, 'off'>;
	trigger: EventTrigger;
}>;

const RUN_CHANNELS: ReadonlySet<EventChannel> = new Set([
	AUTOMATIONS_RUN_CHANGED_CHANNEL,
	AUTOMATIONS_RUN_STARTED_CHANNEL,
	AUTOMATIONS_RUN_FINISHED_CHANNEL,
]);

export type AutomationTriggers = Readonly<{
	handle(event: DispatchedEvent): Promise<boolean>;
	dispose(): void;
}>;

export function startAutomationTriggers(
	context: MainContext,
	log: (line: string) => void,
	shipping: Pick<ShippingRule, 'triggered'>,
): AutomationTriggers {
	const { db, events, commands } = context;
	let armed: readonly ArmedAutomation[] = [];

	const sync = (): void => {
		armed = listAutomationDefinitions(db).flatMap((definition) => {
			const mode = definition.trigger?.mode ?? 'off';
			const trigger = mode === 'off' ? null : eventTriggerOf(definition.trigger?.when ?? '');
			return mode !== 'off' && trigger ? [{ definition, mode, trigger }] : [];
		});
	};

	const handle = async (event: DispatchedEvent): Promise<boolean> => {
		const listening = armed.filter(({ trigger }) => trigger.channel === event.channel);
		if (listening.length === 0) return false;
		const enriched = enrich(event.payload);
		const matching = listening.filter((automation) =>
			automation.trigger.where.every((condition) => holds(enriched, condition)),
		);
		const runs = matching
			.filter((automation) => !triggeredBefore(db, automation.definition.id, event.id))
			.map((automation) => run(automation, event, enriched));
		await Promise.all(runs);
		return matching.length > 0;
	};

	const enrich = (payload: unknown): unknown => {
		if (!isRecord(payload) || findString(payload, 'repositoryId') !== null) return payload;
		const workstreamId = findString(payload, 'workstreamId');
		const repositoryId = workstreamId === null ? null : getWorkstream(db, workstreamId)?.projectId;
		return repositoryId ? { ...payload, repositoryId } : payload;
	};

	const run = async (
		{ definition, mode }: ArmedAutomation,
		event: DispatchedEvent,
		payload: unknown,
	): Promise<void> => {
		const { channel } = event;
		const workstreamId = findString(payload, 'workstreamId');
		const repositoryId = findString(payload, 'repositoryId');
		const parentRunId = RUN_CHANNELS.has(channel) ? runIdOf(payload) : null;
		if (parentRunId !== null && inChain(definition.id, parentRunId)) return;
		const start = (context: string): Promise<AutomationRunRecord> =>
			commands.call('automations.run', {
				definitionId: definition.id,
				origin: 'trigger',
				context: truncateAutomationContext(context),
				waitForYou: mode === 'ask',
				...(workstreamId === null ? {} : { workstreamId }),
				...(repositoryId === null ? {} : { repositoryId }),
				...(parentRunId === null ? {} : { parentRunId }),
				...(event.id === null ? {} : { causeEventId: event.id }),
			});
		try {
			if (await shipping.triggered({ builtin: definition.builtin, event, start })) return;
			await start(
				JSON.stringify({ event: channel, payload: seenPayload(definition, channel, payload) }),
			);
		} catch (error) {
			log(`automations: ${definition.name} did not start on ${channel}: ${describeError(error)}`);
		}
	};

	const inChain = (definitionId: string, runId: string): boolean =>
		automationRunChainDefinitionIds(db, runId, AUTOMATION_CHAIN_MAX_DEPTH).includes(definitionId);

	const onDefinitionChanged = events.subscribe(AUTOMATIONS_DEFINITION_CHANGED_CHANNEL, sync);
	sync();

	return {
		handle,
		dispose() {
			onDefinitionChanged();
		},
	};
}

function seenPayload(
	{ boundary }: AutomationDefinitionRecord,
	channel: EventChannel,
	payload: unknown,
): unknown {
	if (boundary.event === 'full') return payload;
	const repositoryId = findString(payload, 'repositoryId');
	return { ...eventFacts(channel, payload), ...(repositoryId === null ? {} : { repositoryId }) };
}

function eventTriggerOf(when: string): EventTrigger | null {
	try {
		const trigger = parseAutomationTrigger(when);
		return trigger.kind === 'event' ? trigger : null;
	} catch {
		return null;
	}
}

function holds(payload: unknown, { path, equals }: AutomationEventCondition): boolean {
	const value = path
		.split('.')
		.reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), payload);
	if (equals === null) return value !== undefined && value !== null;
	return (
		(typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') &&
		String(value) === equals
	);
}

function runIdOf(payload: unknown): string | null {
	const run = isRecord(payload) ? payload['run'] : undefined;
	const id = isRecord(run) ? run['id'] : undefined;
	return typeof id === 'string' && id.length > 0 ? id : null;
}
