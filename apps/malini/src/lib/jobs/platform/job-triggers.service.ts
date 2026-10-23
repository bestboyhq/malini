import {
	parseAutomationTrigger,
	type AutomationEventCondition,
	type AutomationTrigger,
} from '$contract/automation-trigger';
import {
	JOBS_DEFINITION_CHANGED_CHANNEL,
	JOBS_RUN_CHANGED_CHANNEL,
	type EventChannel,
} from '$contract/events';
import type { JobDefinitionRecord, JobRunMode } from '$contract/jobs';
import type { MainContext } from '$main/context';
import { isRecord } from '$main/db/rows';
import { describeError } from '$main/errors';
import { getWorkstream } from '$shared/repositories/repositories.platform';
import { JOB_CHAIN_MAX_DEPTH, truncateJobContext } from '../domain/job-run';
import { listJobDefinitions } from './job-definitions.repository';
import { jobRunChainDefinitionIds } from './job-runs.repository';

type EventTrigger = Extract<AutomationTrigger, { kind: 'event' }>;

type ArmedJob = Readonly<{
	definition: JobDefinitionRecord;
	mode: Exclude<JobRunMode, 'off'>;
	trigger: EventTrigger;
}>;

export function startJobTriggers(
	context: MainContext,
	log: (line: string) => void,
): { dispose(): void } {
	const { db, events, commands } = context;
	const channels = new Map<EventChannel, () => void>();
	const fired = new Set<string>();
	let armed: readonly ArmedJob[] = [];

	const sync = (): void => {
		armed = listJobDefinitions(db).flatMap((definition) => {
			const mode = definition.trigger?.mode ?? 'off';
			const trigger = mode === 'off' ? null : eventTriggerOf(definition.trigger?.when ?? '');
			return mode !== 'off' && trigger ? [{ definition, mode, trigger }] : [];
		});
		const wanted = new Set(armed.map(({ trigger }) => trigger.channel));
		for (const [channel, unsubscribe] of channels) {
			if (wanted.has(channel)) continue;
			unsubscribe();
			channels.delete(channel);
		}
		for (const channel of wanted) {
			if (channels.has(channel)) continue;
			channels.set(
				channel,
				events.subscribe(channel, (payload: unknown) => {
					try {
						dispatch(channel, payload);
					} catch (error) {
						log(`jobs: trigger on ${channel} failed: ${describeError(error)}`);
					}
				}),
			);
		}
	};

	const dispatch = (channel: EventChannel, payload: unknown): void => {
		const enriched = enrich(payload);
		for (const job of armed) {
			const { trigger, definition } = job;
			if (trigger.channel !== channel || !trigger.where.every((c) => holds(enriched, c))) continue;
			const runKey = JSON.stringify([definition.id, channel, enriched]);
			if (fired.has(runKey)) continue;
			fired.add(runKey);
			run(job, channel, enriched);
		}
	};

	const enrich = (payload: unknown): unknown => {
		if (!isRecord(payload) || findString(payload, 'repositoryId') !== null) return payload;
		const workstreamId = findString(payload, 'workstreamId');
		const repositoryId = workstreamId === null ? null : getWorkstream(db, workstreamId)?.projectId;
		return repositoryId ? { ...payload, repositoryId } : payload;
	};

	const run = ({ definition, mode }: ArmedJob, channel: EventChannel, payload: unknown): void => {
		const workstreamId = findString(payload, 'workstreamId');
		const repositoryId = findString(payload, 'repositoryId');
		const parentRunId = channel === JOBS_RUN_CHANGED_CHANNEL ? runIdOf(payload) : null;
		if (parentRunId !== null && inChain(definition.id, parentRunId)) return;
		commands
			.call('jobs.run', {
				definitionId: definition.id,
				origin: 'trigger',
				context: truncateJobContext(JSON.stringify({ event: channel, payload })),
				waitForYou: mode === 'ask',
				...(workstreamId === null ? {} : { workstreamId }),
				...(repositoryId === null ? {} : { repositoryId }),
				...(parentRunId === null ? {} : { parentRunId }),
			})
			.catch((error: unknown) => {
				log(`jobs: ${definition.name} did not start on ${channel}: ${describeError(error)}`);
			});
	};

	const inChain = (definitionId: string, runId: string): boolean =>
		jobRunChainDefinitionIds(db, runId, JOB_CHAIN_MAX_DEPTH).includes(definitionId);

	const onDefinitionChanged = events.subscribe(JOBS_DEFINITION_CHANGED_CHANNEL, sync);
	sync();

	return {
		dispose() {
			onDefinitionChanged();
			for (const unsubscribe of channels.values()) unsubscribe();
			channels.clear();
		},
	};
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

function findString(payload: unknown, key: string): string | null {
	if (!isRecord(payload)) return null;
	const own = payload[key];
	if (typeof own === 'string' && own.length > 0) return own;
	for (const child of Object.values(payload)) {
		const nested = isRecord(child) ? child[key] : undefined;
		if (typeof nested === 'string' && nested.length > 0) return nested;
	}
	return null;
}

function runIdOf(payload: unknown): string | null {
	const run = isRecord(payload) ? payload['run'] : undefined;
	const id = isRecord(run) ? run['id'] : undefined;
	return typeof id === 'string' && id.length > 0 ? id : null;
}
