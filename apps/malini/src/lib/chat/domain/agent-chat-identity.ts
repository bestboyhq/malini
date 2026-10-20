import type { AgentSessionOrigin } from '$contract/agent';
import type { BackgroundWait } from './background-work';

export type AgentChatActivity =
	'idle' | 'in-progress' | 'in-background' | 'commands-running' | 'needs-approval' | 'failed';

export type AgentChatIdentitySource = {
	displayName: string;
	model: string | null;
	status: 'idle' | 'running' | 'waiting_for_approval' | 'completed' | 'failed';
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
	'commands-running': 'Background commands running',
	'needs-approval': 'Waiting for approval',
	failed: 'Last run failed',
};

export function deriveAgentChatActivity(
	status: AgentChatIdentitySource['status'],
	dispatchPending = false,
	backgroundWait: BackgroundWait | null = null,
): AgentChatActivity {
	if (dispatchPending) return 'in-progress';
	if (status === 'running' && backgroundWait === 'commands') return 'commands-running';
	if (status === 'running') return backgroundWait === 'agents' ? 'in-background' : 'in-progress';
	if (status === 'waiting_for_approval') return 'needs-approval';
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
		name: source.origin === 'job' ? `Job: ${name}` : name,
		activity,
		statusLabel: STATUS_LABELS[activity],
		model: source.model,
	};
}

export function closingStopsAgent(activity: AgentChatActivity): boolean {
	return activity !== 'idle' && activity !== 'failed';
}
