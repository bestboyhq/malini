import type { AgentActionStatus, ChatTurnStatus, AutomationRunStatus } from '$contract/automations';
import type { IconName } from '$hyper-ui/icons';

export type AutomationRunStatusLook = Readonly<{ label: string; icon: IconName; tone: string }>;

export const AUTOMATION_RUN_STATUS: Readonly<Record<AutomationRunStatus, AutomationRunStatusLook>> =
	{
		waiting: { label: 'Waiting for you', icon: 'question', tone: 'text-brand-icon' },
		queued: { label: 'Queued', icon: 'clock', tone: 'text-fg-tertiary' },
		running: { label: 'Running', icon: 'circle-dot', tone: 'text-fg-secondary' },
		'needs-you': { label: 'Needs you', icon: 'dot', tone: 'text-brand-icon' },
		succeeded: { label: 'Done', icon: 'check', tone: 'text-success-content' },
		failed: { label: 'Failed', icon: 'close', tone: 'text-error-content' },
		cancelled: { label: 'Cancelled', icon: 'circle-slash', tone: 'text-fg-tertiary' },
	};

export const AGENT_ACTION_STATUS: Readonly<Record<AgentActionStatus, AutomationRunStatusLook>> = {
	running: AUTOMATION_RUN_STATUS.running,
	succeeded: AUTOMATION_RUN_STATUS.succeeded,
	failed: AUTOMATION_RUN_STATUS.failed,
	denied: { label: 'Denied', icon: 'circle-slash', tone: 'text-fg-tertiary' },
};

export const CHAT_TURN_STATUS: Readonly<Record<ChatTurnStatus, AutomationRunStatusLook>> = {
	running: AUTOMATION_RUN_STATUS.running,
	succeeded: AUTOMATION_RUN_STATUS.succeeded,
	failed: AUTOMATION_RUN_STATUS.failed,
	cancelled: AUTOMATION_RUN_STATUS.cancelled,
	interrupted: { label: 'Interrupted', icon: 'circle-pause', tone: 'text-fg-tertiary' },
};
