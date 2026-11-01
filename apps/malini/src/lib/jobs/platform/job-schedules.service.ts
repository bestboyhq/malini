import type { SchedulePlace } from '$contract/automation-trigger';
import {
	JOBS_DEFINITION_CHANGED_CHANNEL,
	JOBS_RUN_CHANGED_CHANNEL,
	JOBS_TIME_REACHED_CHANNEL,
} from '$contract/events';
import type {
	JobRunChangedEvent,
	JobRunRecord,
	JobRunStatus,
	RunJobArgs,
	TimeReachedEvent,
} from '$contract/jobs';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { describeError } from '$main/errors';
import {
	getWorkstream,
	leadScopeKey,
	listRepositoryCatalog,
	listWorkstreams,
	resolveConnectedRepository,
	type CatalogRepository,
} from '$shared/repositories/repositories.platform';
import { latestScheduleSlot, scheduledJobOf, type ScheduledJob } from '../domain/schedule';
import { takeDueAlarms } from './alarms.repository';
import { triggeredBefore } from './event-log.repository';
import { findString, type DispatchedEvent } from './event-log.service';
import {
	getBuiltinJobDefinition,
	getJobDefinition,
	listJobDefinitions,
} from './job-definitions.repository';
import {
	countUnfinishedJobRuns,
	latestScheduledJobRun,
	latestScheduledWorkstreamId,
} from './job-runs.repository';

export const SCHEDULE_CHECK_INTERVAL_MS = 30_000;

export const ALARM_CHECK_INTERVAL_MS = 1_000;

const DUE_FORMAT = new Intl.DateTimeFormat('en-US', {
	weekday: 'long',
	month: 'long',
	day: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23',
});

const NOTIFIED_STATUSES: ReadonlySet<JobRunStatus> = new Set([
	'waiting',
	'needs-you',
	'succeeded',
	'failed',
]);

export type JobSchedules = Readonly<{
	handle(event: DispatchedEvent): Promise<void>;
	start(): void;
	dispose(): void;
}>;

export type JobSchedulesOptions = Readonly<{ alarmCheckMs?: number; now?: () => number }>;

export function createJobSchedules(
	context: MainContext,
	log: (line: string) => void,
	options: JobSchedulesOptions = {},
): JobSchedules {
	const { db, events, commands } = context;
	const attempted = new Map<string, number>();
	const notified = new Map<string, JobRunStatus>();
	const unsubscribes: Array<() => void> = [];
	let clock: ReturnType<typeof setInterval> | null = null;
	let alarms: ReturnType<typeof setInterval> | null = null;
	let scheduled: readonly ScheduledJob[] = [];

	const ring = (): void => {
		const now = options.now?.() ?? Date.now();
		for (const reached of takeDueAlarms(db, new Date(now).toISOString())) {
			events.emit(JOBS_TIME_REACHED_CHANNEL, reached);
		}
	};

	const check = (): void => {
		const now = Date.now();
		for (const { definition, schedule } of scheduled) {
			const due = latestScheduleSlot(schedule, now);
			const since = Math.max(
				...[definition.updatedAt, latestScheduledJobRun(db, definition.id)?.createdAt]
					.map((time) => Date.parse(time ?? ''))
					.filter(Number.isFinite),
				attempted.get(definition.id) ?? Number.NEGATIVE_INFINITY,
			);
			if (due <= since) continue;
			attempted.set(definition.id, due);
			const reached: TimeReachedEvent = {
				definitionId: definition.id,
				name: definition.name,
				when: definition.trigger?.when ?? '',
				due: new Date(due).toISOString(),
			};
			events.emit(JOBS_TIME_REACHED_CHANNEL, reached);
		}
	};

	const handle = async (event: DispatchedEvent): Promise<void> => {
		if (event.channel !== JOBS_TIME_REACHED_CHANNEL) return;
		const definition = getJobDefinition(db, findString(event.payload, 'definitionId') ?? '');
		const job = definition === null ? null : scheduledJobOf(definition);
		const due = Date.parse(findString(event.payload, 'due') ?? '');
		if (job === null || !Number.isFinite(due)) return;
		const { id, name, trigger } = job.definition;
		if (triggeredBefore(db, id, event.id)) return;
		if (countUnfinishedJobRuns(db, id) > 0) {
			log(`jobs: ${name} skips a run on its schedule, its last run has not finished`);
			return;
		}
		try {
			const target = await placeTarget(db, id, job.schedule.place);
			const skipped = await updateFirst(context, target.workstreamId ?? null, event);
			await commands.call('jobs.run', {
				definitionId: id,
				origin: 'schedule',
				context: [
					`Malini started this run on its schedule, ${trigger?.when ?? ''}, due ${DUE_FORMAT.format(due)}.`,
					...(skipped === null ? [] : [skipped]),
				].join('\n\n'),
				waitForYou: job.mode === 'ask',
				...(event.id === null ? {} : { causeEventId: event.id }),
				...target,
			});
		} catch (error) {
			log(`jobs: ${name} did not start on its schedule: ${describeError(error)}`);
		}
	};

	const notify = async (run: JobRunRecord): Promise<void> => {
		if (run.origin !== 'schedule' || notified.get(run.id) === run.status) return;
		if (!scheduled.some(({ definition }) => definition.id === run.definitionId)) return;
		notified.set(run.id, run.status);
		if (!NOTIFIED_STATUSES.has(run.status)) return;
		try {
			if ((await commands.call('app.notification-permission-granted', undefined)) !== true) return;
			await commands.call('app.notify', {
				options: {
					...runNotice(run),
					...(run.workstreamId && run.sessionId
						? { opens: { workstreamId: run.workstreamId, sessionId: run.sessionId } }
						: {}),
				},
			});
		} catch (error) {
			log(`jobs: could not tell you about ${run.title}: ${describeError(error)}`);
		}
	};

	const sync = (): void => {
		scheduled = listJobDefinitions(db).flatMap((definition) => scheduledJobOf(definition) ?? []);
		check();
	};

	return {
		handle,
		start() {
			if (clock !== null) return;
			unsubscribes.push(
				events.subscribe(JOBS_DEFINITION_CHANGED_CHANNEL, sync),
				events.subscribe(JOBS_RUN_CHANGED_CHANNEL, ({ run }: JobRunChangedEvent) => {
					void notify(run);
				}),
			);
			clock = setInterval(check, SCHEDULE_CHECK_INTERVAL_MS);
			alarms = setInterval(ring, options.alarmCheckMs ?? ALARM_CHECK_INTERVAL_MS);
			sync();
			ring();
		},
		dispose() {
			for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
			if (clock !== null) clearInterval(clock);
			if (alarms !== null) clearInterval(alarms);
			clock = null;
			alarms = null;
		},
	};
}

async function updateFirst(
	context: MainContext,
	workstreamId: string | null,
	event: DispatchedEvent,
): Promise<string | null> {
	const { db, commands } = context;
	const workstream = workstreamId === null ? null : getWorkstream(db, workstreamId);
	if (workstreamId === null || !workstream || workstream.scope !== null) return null;
	const baseBranch =
		workstream.baseBranch ||
		(await resolveConnectedRepository(db, workstream.projectId))?.defaultBranch;
	if (!baseBranch) return null;
	const skipped = `Malini did not merge ${baseBranch} into this workstream before this run`;
	try {
		const status = await commands.call('repositories.workstream-status', { workstreamId });
		if (status.operationInProgress !== null) {
			return `${skipped}: a ${status.operationInProgress} is in progress.`;
		}
		if (status.dirtyPaths.length > 0) return `${skipped}: it has uncommitted changes.`;
		const args = { workstreamId, baseBranch };
		if ((await commands.call('repositories.count-behind-base', args)) === 0) return null;
		const updater = getBuiltinJobDefinition(db, 'update-from-main');
		if (!updater) return null;
		await commands.call('jobs.run', {
			definitionId: updater.id,
			workstreamId,
			origin: 'schedule',
			...(event.id === null ? {} : { causeEventId: event.id }),
		});
		return null;
	} catch (error) {
		return `${skipped}: ${describeError(error)}`;
	}
}

async function placeTarget(
	db: MaliniDatabase,
	definitionId: string,
	place: SchedulePlace,
): Promise<Pick<RunJobArgs, 'workstreamId' | 'repositoryId' | 'scope'>> {
	const previousId = latestScheduledWorkstreamId(db, definitionId);
	const previous = listWorkstreams(db).find((workstream) => workstream.id === previousId);
	if (place.kind !== 'repository') {
		const scope = leadScopeKey(place);
		return previous?.scope === scope ? { workstreamId: previous.id, scope } : { scope };
	}
	const repository = await catalogRepository(db, place.repository);
	if (!repository) throw new Error(`${place.repository} is no longer in Malini.`);
	return previous && previous.scope === null && repository.projectIds.includes(previous.projectId)
		? { workstreamId: previous.id }
		: { repositoryId: repository.id };
}

async function catalogRepository(
	db: MaliniDatabase,
	fullName: string,
): Promise<CatalogRepository | null> {
	const wanted = fullName.toLocaleLowerCase();
	return (
		(await listRepositoryCatalog(db)).find(
			(repository) => repository.fullName.toLocaleLowerCase() === wanted,
		) ?? null
	);
}

function runNotice({ title, status, detail }: JobRunRecord): { title: string; body: string } {
	if (status === 'waiting') {
		return { title: `${title} wants to run`, body: 'It waits for your yes in the Job center.' };
	}
	if (status === 'needs-you') {
		return { title: `${title} is waiting`, body: detail ?? 'It asks you before it goes on.' };
	}
	if (status === 'failed') return { title: `${title} failed`, body: detail ?? 'The run failed.' };
	return { title: `${title} finished`, body: detail ?? 'It ran on its schedule.' };
}
