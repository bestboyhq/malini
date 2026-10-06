export type AgentChatActivity = 'idle' | 'in-progress' | 'needs-approval' | 'failed';

export type AgentChatIdentitySource = {
	displayName: string;
	model: string | null;
	status: 'idle' | 'running' | 'waiting_for_approval' | 'completed' | 'failed';
	lastError?: string | null;
};

export type AgentChatIdentity = {
	name: string;
	activity: AgentChatActivity;
	statusLabel: string;
	model: string | null;
};

export function deriveAgentChatActivity(
	status: AgentChatIdentitySource['status'],
	dispatchPending = false,
): AgentChatActivity {
	if (dispatchPending || status === 'running') return 'in-progress';
	if (status === 'waiting_for_approval') return 'needs-approval';
	if (status === 'failed') return 'failed';
	return 'idle';
}

export function agentChatIdentity(
	source: AgentChatIdentitySource,
	dispatchPending = false,
): AgentChatIdentity {
	const activity = deriveAgentChatActivity(source.status, dispatchPending);
	const statusLabel =
		activity === 'in-progress'
			? 'Working'
			: activity === 'needs-approval'
				? 'Waiting for approval'
				: activity === 'failed'
					? 'Last run failed'
					: 'Ready';
	return {
		name: source.displayName.trim() || 'Chat',
		activity,
		statusLabel,
		model: source.model,
	};
}
