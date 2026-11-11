import type { AgentSessionOrigin } from '$contract/agent';
import { isWaitingForUser, type SessionStatus } from '$contract/agent-state-machine';
import type { BackgroundWait } from './background-work';

export type AgentChatActivity =
	'idle' | 'in-progress' | 'in-background' | 'needs-approval' | 'failed';

export type AgentChatIdentitySource = {
	displayName: string;
	model: string | null;
	status: SessionStatus;
	lastError?: string | null;
	origin?: AgentSessionOrigin;
	backgroundWait?: BackgroundWait | null;
};

export type AgentChatIdentity = {
	name: string;
	activity: AgentChatActivity;
	statusLabel: string;
	model: string | null;
};

const STATUS_LABELS: Readonly<Record<AgentChatActivity, string>> = {
	idle: 'Ready',
	'in-progress': 'Working',
	'in-background': 'Background agents running',
	'needs-approval': 'Waiting for approval',
	failed: 'Last run failed',
};

export function deriveAgentChatActivity(
	status: AgentChatIdentitySource['status'],
	dispatchPending = false,
	backgroundWait: BackgroundWait | null = null,
): AgentChatActivity {
	if (dispatchPending) return 'in-progress';
	if (status === 'running') return backgroundWait === 'agents' ? 'in-background' : 'in-progress';
	if (isWaitingForUser(status)) return 'needs-approval';
	if (status === 'failed') return 'failed';
	return 'idle';
}

export function agentChatIdentity(
	source: AgentChatIdentitySource,
	dispatchPending = false,
): AgentChatIdentity {
	const activity = deriveAgentChatActivity(source.status, dispatchPending, source.backgroundWait);
	const name = source.displayName.trim() || 'Chat';
	return {
		name: source.origin === 'automation' ? `Automation: ${name}` : name,
		activity,
		statusLabel: STATUS_LABELS[activity],
		model: source.model,
	};
}

export function closingStopsAgent(activity: AgentChatActivity): boolean {
	return activity !== 'idle' && activity !== 'failed';
}
