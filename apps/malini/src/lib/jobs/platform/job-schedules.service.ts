import type { SchedulePlace } from '$contract/automation-trigger';
import { JOBS_DEFINITION_CHANGED_CHANNEL, JOBS_RUN_CHANGED_CHANNEL } from '$contract/events';
import type { JobRunChangedEvent, JobRunRecord, JobRunStatus, RunJobArgs } from '$contract/jobs';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { describeError } from '$main/errors';
import {
	leadScopeKey,
	listRepositoryCatalog,
	listWorkstreams,
	type CatalogRepository,
} from '$shared/repositories/repositories.platform';
import { latestScheduleSlot, scheduledJobOf, type ScheduledJob } from '../domain/schedule';
import { listJobDefinitions } from './job-definitions.repository';
import {
	countUnfinishedJobRuns,
	latestScheduledJobRun,
	latestScheduledWorkstreamId,
} from './job-runs.repository';

export const SCHEDULE_CHECK_INTERVAL_MS = 30_000;

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

export function startJobSchedules(
	context: MainContext,
	log: (line: string) => void,
): { dispose(): void } {
	const { db, events, commands } = context;
	const attempted = new Map<string, number>();
	const notified = new Map<string, JobRunStatus>();
	let scheduled: readonly ScheduledJob[] = [];

	const check = (): void => {
		const now = Date.now();
		for (const job of scheduled) {
			const { definition } = job;
			const due = latestScheduleSlot(job.schedule, now);
			const since = Math.max(
				...[definition.updatedAt, latestScheduledJobRun(db, definition.id)?.createdAt]
					.map((time) => Date.parse(time ?? ''))
					.filter(Number.isFinite),
				attempted.get(definition.id) ?? Number.NEGATIVE_INFINITY,
			);
			if (due <= since) continue;
			attempted.set(definition.id, due);
			if (countUnfinishedJobRuns(db, definition.id) > 0) {
				log(`jobs: ${definition.name} skips a run on its schedule, its last run has not finished`);
				continue;
			}
			void start(job, due);
		}
	};

	const start = async (
		{ definition, mode, schedule }: ScheduledJob,
		due: number,
	): Promise<void> => {
		try {
			await commands.call('jobs.run', {
				definitionId: definition.id,
				origin: 'schedule',
				context: `Malini started this run on its schedule, ${definition.trigger?.when ?? ''}, due ${DUE_FORMAT.format(due)}.`,
				waitForYou: mode === 'ask',
				...(await placeTarget(db, definition.id, schedule.place)),
			});
		} catch (error) {
			log(`jobs: ${definition.name} did not start on its schedule: ${describeError(error)}`);
		}
	};

	const notify = async (run: JobRunRecord): Promise<void> => {
		if (run.origin !== 'schedule' || notified.get(run.id) === run.status) return;
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

	const unsubscribes = [
		events.subscribe(JOBS_DEFINITION_CHANGED_CHANNEL, sync),
		events.subscribe(JOBS_RUN_CHANGED_CHANNEL, ({ run }: JobRunChangedEvent) => {
			void notify(run);
		}),
	];
	const clock = setInterval(check, SCHEDULE_CHECK_INTERVAL_MS);
	sync();

	return {
		dispose() {
			for (const unsubscribe of unsubscribes) unsubscribe();
			clearInterval(clock);
		},
	};
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
		return { title: `${title} wants to run`, body: 'It waits for your yes under Automations.' };
	}
	if (status === 'needs-you') {
		return { title: `${title} is waiting`, body: detail ?? 'It asks you before it goes on.' };
	}
	if (status === 'failed') return { title: `${title} failed`, body: detail ?? 'The run failed.' };
	return { title: `${title} finished`, body: detail ?? 'It ran on its schedule.' };
}
