import type { JobRunStatus } from '$contract/jobs';
import type { IconName } from '$hyper-ui/icons';

export type JobRunStatusLook = Readonly<{ label: string; icon: IconName; tone: string }>;

export const JOB_RUN_STATUS: Readonly<Record<JobRunStatus, JobRunStatusLook>> = {
	waiting: { label: 'Waiting for you', icon: 'question', tone: 'text-warning-content' },
	queued: { label: 'Queued', icon: 'clock', tone: 'text-fg-tertiary' },
	running: { label: 'Running', icon: 'circle-dot', tone: 'text-fg-secondary' },
	'needs-you': { label: 'Needs you', icon: 'alert', tone: 'text-warning-content' },
	succeeded: { label: 'Done', icon: 'check', tone: 'text-success-content' },
	failed: { label: 'Failed', icon: 'close', tone: 'text-error-content' },
	cancelled: { label: 'Cancelled', icon: 'circle-slash', tone: 'text-fg-tertiary' },
};
