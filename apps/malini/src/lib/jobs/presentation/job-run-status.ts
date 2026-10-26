import type { AgentActionStatus, ChatTurnStatus, JobRunStatus } from '$contract/jobs';
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

export const AGENT_ACTION_STATUS: Readonly<Record<AgentActionStatus, JobRunStatusLook>> = {
	running: JOB_RUN_STATUS.running,
	succeeded: JOB_RUN_STATUS.succeeded,
	failed: JOB_RUN_STATUS.failed,
	denied: { label: 'Denied', icon: 'circle-slash', tone: 'text-fg-tertiary' },
};

export const CHAT_TURN_STATUS: Readonly<Record<ChatTurnStatus, JobRunStatusLook>> = {
	running: JOB_RUN_STATUS.running,
	succeeded: JOB_RUN_STATUS.succeeded,
	failed: JOB_RUN_STATUS.failed,
	cancelled: JOB_RUN_STATUS.cancelled,
	interrupted: { label: 'Interrupted', icon: 'pause', tone: 'text-fg-tertiary' },
};
