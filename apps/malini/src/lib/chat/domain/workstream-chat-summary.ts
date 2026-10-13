import { attentionNeedsUser, type AgentAttention } from '$lib/chat/domain/agent-attention';
import type { SessionId } from '$lib/chat/domain/session';
import type { SessionRecord } from '$lib/chat/domain/session-record';

export type WorkstreamChatTone =
	'running' | 'waiting' | 'queued' | 'failed' | 'completed' | 'draft';

export type WorkstreamChatState = Readonly<{
	label: string;
	tone: WorkstreamChatTone;
}>;

export type WorkstreamChatSummary = Readonly<{
	sessionId: SessionId | null;
	queueCount: number;
	attention: AgentAttention | null;
	needsYou: boolean;
	hasDraft: boolean;
	state: WorkstreamChatState | null;
}>;

type WorkstreamChatSummaryInput = Readonly<{
	session: SessionRecord | null;
	jobRunning: boolean;
	queueCount: number;
	attention: AgentAttention | null;
	hasDraft: boolean;
}>;

export function summarizeWorkstreamChat(input: WorkstreamChatSummaryInput): WorkstreamChatSummary {
	return {
		sessionId: input.session?.id ?? null,
		queueCount: input.queueCount,
		attention: input.attention,
		needsYou: attentionNeedsUser(input.attention),
		hasDraft: input.hasDraft,
		state: workstreamChatState(input),
	};
}

function workstreamChatState(input: WorkstreamChatSummaryInput): WorkstreamChatState | null {
	const status = input.session?.status;
	if (status === 'waiting_for_approval') return { label: 'Approval', tone: 'waiting' };
	if (status === 'running' || input.jobRunning) return { label: 'Running', tone: 'running' };
	if (input.queueCount > 0) return { label: `${input.queueCount} queued`, tone: 'queued' };
	if (input.attention?.kind === 'failed') return { label: 'Failed', tone: 'failed' };
	if (input.attention?.kind === 'approval') return { label: 'Approval', tone: 'waiting' };
	if (input.attention?.kind === 'input') return { label: 'Needs you', tone: 'waiting' };
	if (input.attention?.kind === 'completed') return { label: 'Ready', tone: 'completed' };
	if (status === 'failed') return { label: 'Failed', tone: 'failed' };
	if (status === 'completed') return { label: 'Ready', tone: 'completed' };
	if (input.hasDraft) return { label: 'Draft', tone: 'draft' };
	return null;
}
