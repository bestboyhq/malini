import { JOBS_RUN_CHANGED_CHANNEL } from '$contract/events';
import type { JobRunRecord, JobRunStatus } from '$contract/jobs';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

export interface WorkstreamRoutineJobRunner {
	run(definitionId: string, workstreamId: string, signal: AbortSignal): Promise<void>;
}

export function createUnavailableRoutineJobRunner(): WorkstreamRoutineJobRunner {
	return {
		run: () => Promise.reject(new Error('Job steps need the jobs platform')),
	};
}

export function createPlatformRoutineJobRunner(): WorkstreamRoutineJobRunner {
	return {
		async run(definitionId, workstreamId, signal) {
			signal.throwIfAborted();
			const watch = watchJobRuns();
			try {
				const started = await invoke('jobs.run', { definitionId, workstreamId, origin: 'routine' });
				const finished = await watch.finished(started, signal);
				if (finished.status !== 'succeeded') throw new Error(jobFailure(finished));
			} finally {
				watch.stop();
			}
		},
	};
}

const TERMINAL_STATUSES: ReadonlySet<JobRunStatus> = new Set(['succeeded', 'failed', 'cancelled']);

type JobRunWatch = Readonly<{
	finished(started: JobRunRecord, signal: AbortSignal): Promise<JobRunRecord>;
	stop(): void;
}>;

function watchJobRuns(): JobRunWatch {
	const latest = new Map<string, JobRunRecord>();
	let waiter: Readonly<{ runId: string; settle(run: JobRunRecord): void }> | null = null;
	const stop = onPlatformEvent(JOBS_RUN_CHANGED_CHANNEL, ({ run }) => {
		latest.set(run.id, run);
		if (waiter?.runId === run.id && TERMINAL_STATUSES.has(run.status)) waiter.settle(run);
	});
	return {
		stop,
		finished(started, signal) {
			const known = latest.get(started.id) ?? started;
			if (TERMINAL_STATUSES.has(known.status)) return Promise.resolve(known);
			return new Promise<JobRunRecord>((resolve, reject) => {
				const onAbort = (): void => {
					waiter = null;
					reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'));
				};
				if (signal.aborted) {
					onAbort();
					return;
				}
				signal.addEventListener('abort', onAbort, { once: true });
				waiter = {
					runId: started.id,
					settle: (run) => {
						signal.removeEventListener('abort', onAbort);
						waiter = null;
						resolve(run);
					},
				};
			});
		},
	};
}

function jobFailure(run: JobRunRecord): string {
	const outcome = run.status === 'cancelled' ? 'was cancelled' : 'failed';
	return `Job “${run.title}” ${outcome}${run.detail ? `: ${run.detail}` : ''}`;
}
