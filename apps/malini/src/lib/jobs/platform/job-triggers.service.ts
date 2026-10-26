import {
	parseAutomationTrigger,
	type AutomationEventCondition,
	type AutomationTrigger,
} from '$contract/automation-trigger';
import {
	JOBS_DEFINITION_CHANGED_CHANNEL,
	JOBS_RUN_CHANGED_CHANNEL,
	JOBS_RUN_FINISHED_CHANNEL,
	JOBS_RUN_STARTED_CHANNEL,
	type EventChannel,
} from '$contract/events';
import type { JobDefinitionRecord, JobRunMode } from '$contract/jobs';
import type { MainContext } from '$main/context';
import { isRecord } from '$main/db/rows';
import { describeError } from '$main/errors';
import { getWorkstream } from '$shared/repositories/repositories.platform';
import { JOB_CHAIN_MAX_DEPTH, truncateJobContext } from '../domain/job-run';
import { triggeredBefore } from './event-log.repository';
import { eventDigest, findString, type DispatchedEvent } from './event-log.service';
import { listJobDefinitions } from './job-definitions.repository';
import { jobRunChainDefinitionIds } from './job-runs.repository';

type EventTrigger = Extract<AutomationTrigger, { kind: 'event' }>;

type ArmedJob = Readonly<{
	definition: JobDefinitionRecord;
	mode: Exclude<JobRunMode, 'off'>;
	trigger: EventTrigger;
}>;

// ponytail: forgets which events already started a job past 5 000, leaving only the event log's check; key the guard on the event id if a burst ever outruns it
const FIRED_LIMIT = 5_000;

const RUN_CHANNELS: ReadonlySet<EventChannel> = new Set([
	JOBS_RUN_CHANGED_CHANNEL,
	JOBS_RUN_STARTED_CHANNEL,
	JOBS_RUN_FINISHED_CHANNEL,
]);

export type JobTriggers = Readonly<{
	handle(event: DispatchedEvent): Promise<boolean>;
	dispose(): void;
}>;

export function startJobTriggers(context: MainContext, log: (line: string) => void): JobTriggers {
	const { db, events, commands } = context;
	const fired = new Set<string>();
	let armed: readonly ArmedJob[] = [];

	const sync = (): void => {
		armed = listJobDefinitions(db).flatMap((definition) => {
			const mode = definition.trigger?.mode ?? 'off';
			const trigger = mode === 'off' ? null : eventTriggerOf(definition.trigger?.when ?? '');
			return mode !== 'off' && trigger ? [{ definition, mode, trigger }] : [];
		});
	};

	const handle = async (event: DispatchedEvent): Promise<boolean> => {
		const listening = armed.filter(({ trigger }) => trigger.channel === event.channel);
		if (listening.length === 0) return false;
		const enriched = enrich(event.payload);
		const digest = event.digest ?? eventDigest(event.payload);
		const matching = listening.filter((job) =>
			job.trigger.where.every((condition) => holds(enriched, condition)),
		);
		const runs = matching.flatMap((job) => {
			const { definition } = job;
			const firedKey = JSON.stringify([definition.id, event.channel, digest]);
			if (fired.has(firedKey)) return [];
			if (fired.size >= FIRED_LIMIT) fired.clear();
			fired.add(firedKey);
			if (triggeredBefore(db, definition.id, event.channel, digest)) return [];
			return [run(job, event, enriched)];
		});
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
		{ definition, mode }: ArmedJob,
		event: DispatchedEvent,
		payload: unknown,
	): Promise<void> => {
		const { channel } = event;
		const workstreamId = findString(payload, 'workstreamId');
		const repositoryId = findString(payload, 'repositoryId');
		const parentRunId = RUN_CHANNELS.has(channel) ? runIdOf(payload) : null;
		if (parentRunId !== null && inChain(definition.id, parentRunId)) return;
		await commands
			.call('jobs.run', {
				definitionId: definition.id,
				origin: 'trigger',
				context: truncateJobContext(JSON.stringify({ event: channel, payload })),
				waitForYou: mode === 'ask',
				...(workstreamId === null ? {} : { workstreamId }),
				...(repositoryId === null ? {} : { repositoryId }),
				...(parentRunId === null ? {} : { parentRunId }),
				...(event.id === null ? {} : { causeEventId: event.id }),
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
		handle,
		dispose() {
			onDefinitionChanged();
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

function runIdOf(payload: unknown): string | null {
	const run = isRecord(payload) ? payload['run'] : undefined;
	const id = isRecord(run) ? run['id'] : undefined;
	return typeof id === 'string' && id.length > 0 ? id : null;
}
