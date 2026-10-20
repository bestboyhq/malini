import { randomUUID } from 'node:crypto';
import {
	parseAutomationTrigger,
	type AutomationEventCondition,
	type AutomationTrigger,
} from '$contract/automation-trigger';
import {
	JOBS_RUN_CHANGED_CHANNEL,
	ROUTINES_CHANGED_CHANNEL,
	ROUTINES_GATED_RUN_CHANGED_CHANNEL,
	type EventChannel,
} from '$contract/events';
import type { JobRunRecord, RunJobArgs } from '$contract/jobs';
import type { RoutineRecord, RoutineRun } from '$contract/routines';
import type { MainContext } from '$main/context';
import { isRecord, nowIso8601 } from '$main/db/rows';
import { JOB_CONTEXT_MAX_BYTES } from '$lib/jobs/jobs.platform';
import { getWorkstream } from '$shared/repositories/repositories.platform';
import { getRoutine, listRoutines, recordGatedRun } from './routines.repository';

type EventTrigger = Extract<AutomationTrigger, { kind: 'event' }>;

type ArmedRoutine = Readonly<{ routine: RoutineRecord; trigger: EventTrigger }>;

const ARMED_STATUSES: ReadonlySet<RoutineRecord['status']> = new Set(['candidate', 'routine']);

const TERMINAL_JOB_STATUSES: ReadonlySet<JobRunRecord['status']> = new Set([
	'succeeded',
	'failed',
	'cancelled',
]);

export function eventTriggerOf(when: string): EventTrigger | null {
	try {
		const trigger = parseAutomationTrigger(when);
		return trigger.kind === 'event' ? trigger : null;
	} catch {
		return null;
	}
}

export function startEventTriggers(
	context: MainContext,
	log: (line: string) => void,
): { dispose(): void } {
	const { db, events, commands } = context;
	const channels = new Map<EventChannel, () => void>();
	const fired = new Set<string>();
	const jobWaiters = new Set<(run: JobRunRecord) => void>();
	let armed: readonly ArmedRoutine[] = [];
	let selfEmitting = 0;

	const sync = (): void => {
		armed = listRoutines(db).flatMap((routine) => {
			const trigger = ARMED_STATUSES.has(routine.status) ? eventTriggerOf(routine.when) : null;
			return trigger ? [{ routine, trigger }] : [];
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
					if (selfEmitting > 0 || isRoutineJobRun(channel, payload)) return;
					try {
						dispatch(channel, payload);
					} catch (error) {
						log(`routines: event trigger on ${channel} failed: ${describe(error)}`);
					}
				}),
			);
		}
	};

	const dispatch = (channel: EventChannel, payload: unknown): void => {
		const enriched = enrich(payload);
		for (const { routine, trigger } of armed) {
			if (trigger.channel !== channel || !trigger.where.every((c) => holds(enriched, c))) continue;
			const runKey = JSON.stringify([routine.id, channel, enriched]);
			if (fired.has(runKey)) continue;
			fired.add(runKey);
			if (routine.status === 'candidate') hold(routine, channel, enriched, runKey);
			else run(routine, channel, enriched);
		}
	};

	const hold = (
		routine: RoutineRecord,
		channel: EventChannel,
		payload: unknown,
		runKey: string,
	): void => {
		const { record, created } = recordGatedRun(db, {
			id: randomUUID(),
			routineId: routine.id,
			workstreamId: findString(payload, 'workstreamId') ?? '',
			runKey,
			event: channel,
			payload,
			createdAt: nowIso8601(),
		});
		if (!created) return;
		selfEmitting += 1;
		try {
			events.emit(ROUTINES_GATED_RUN_CHANGED_CHANNEL, { gatedRun: record });
		} finally {
			selfEmitting -= 1;
		}
	};

	const runSteps = async (
		routine: RoutineRecord,
		channel: string,
		payload: unknown,
	): Promise<void> => {
		const workstreamId = findString(payload, 'workstreamId');
		const repositoryId = findString(payload, 'repositoryId');
		const jobContext = truncateBytes(JSON.stringify({ event: channel, payload }));
		for (const step of routine.steps) {
			if (!('job' in step)) throw new Error(`routine \`${routine.id}\` has a non-job step`);
			const finished = await runJob({
				definitionId: step.job,
				origin: 'routine',
				context: jobContext,
				...(workstreamId === null ? {} : { workstreamId }),
				...(repositoryId === null ? {} : { repositoryId }),
			});
			if (finished.status !== 'succeeded') {
				throw new Error(`job “${finished.title}” ${finished.status}${detail(finished)}`);
			}
		}
	};

	const runJob = async (args: RunJobArgs): Promise<JobRunRecord> => {
		const latest = new Map<string, JobRunRecord>();
		let settle: ((run: JobRunRecord) => void) | null = null;
		const watch = (run: JobRunRecord): void => {
			latest.set(run.id, run);
			if (TERMINAL_JOB_STATUSES.has(run.status)) settle?.(run);
		};
		jobWaiters.add(watch);
		try {
			const started = await commands.call('jobs.run', args);
			const known = latest.get(started.id) ?? started;
			if (TERMINAL_JOB_STATUSES.has(known.status)) return known;
			return await new Promise<JobRunRecord>((resolve) => {
				settle = (run) => {
					if (run.id === started.id) resolve(run);
				};
			});
		} finally {
			jobWaiters.delete(watch);
		}
	};

	const enrich = (payload: unknown): unknown => {
		if (!isRecord(payload) || findString(payload, 'repositoryId') !== null) return payload;
		const workstreamId = findString(payload, 'workstreamId');
		const repositoryId = workstreamId === null ? null : getWorkstream(db, workstreamId)?.projectId;
		return repositoryId ? { ...payload, repositoryId } : payload;
	};

	const run = (routine: RoutineRecord, channel: string, payload: unknown): void => {
		void runSteps(routine, channel, payload).catch((error: unknown) => {
			log(`routines: routine \`${routine.id}\` on ${channel} failed: ${describe(error)}`);
		});
	};

	const onGatedRunChanged = events.subscribe(ROUTINES_GATED_RUN_CHANGED_CHANNEL, ({ gatedRun }) => {
		if (gatedRun.state !== 'confirmed') return;
		const routine = getRoutine(db, gatedRun.routineId);
		if (routine && eventTriggerOf(routine.when)) run(routine, gatedRun.event, gatedRun.payload);
	});
	const onRoutinesChanged = events.subscribe(ROUTINES_CHANGED_CHANNEL, sync);
	const onJobRunChanged = events.subscribe(JOBS_RUN_CHANGED_CHANNEL, ({ run }) => {
		for (const waiter of jobWaiters) waiter(run);
	});
	sync();

	return {
		dispose() {
			onGatedRunChanged();
			onRoutinesChanged();
			onJobRunChanged();
			for (const unsubscribe of channels.values()) unsubscribe();
			channels.clear();
			jobWaiters.clear();
		},
	};
}

export function requireRunnableSteps(when: string, steps: readonly RoutineRun[]): void {
	if (eventTriggerOf(when) === null || steps.every((step) => 'job' in step)) return;
	throw new Error(
		'A routine that runs `on <channel>` runs in the background, so every step must be a job (`{ job }`).',
	);
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

function isRoutineJobRun(channel: EventChannel, payload: unknown): boolean {
	if (channel !== JOBS_RUN_CHANGED_CHANNEL || !isRecord(payload)) return false;
	const run = payload['run'];
	return isRecord(run) && run['origin'] === 'routine';
}

function truncateBytes(text: string): string {
	let truncated = Buffer.from(text, 'utf8').subarray(0, JOB_CONTEXT_MAX_BYTES).toString('utf8');
	while (Buffer.byteLength(truncated, 'utf8') > JOB_CONTEXT_MAX_BYTES) {
		truncated = truncated.slice(0, -1);
	}
	return truncated;
}

function detail(run: JobRunRecord): string {
	return run.detail ? `: ${run.detail}` : '';
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
