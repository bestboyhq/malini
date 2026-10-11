import type { AgentAttention, AgentAttentionKind } from '$lib/chat/domain/agent-attention';

const MINUTE_MS = 60_000;

const KIND_LINE: Readonly<Record<AgentAttentionKind, string>> = {
	completed: 'Finished',
	input: 'Needs your input',
	failed: 'Run failed',
	approval: 'Waiting for your approval',
};

export function inboxLine(attention: AgentAttention): string {
	return attention.outcome ?? attention.body ?? KIND_LINE[attention.kind];
}

export function inboxStatus(kind: AgentAttentionKind): string | null {
	if (kind === 'failed') return 'Failed';
	if (kind === 'approval') return 'Waiting for approval';
	return null;
}

export function timeAgo(timestamp: number, now: number): string {
	const minutes = Math.floor((now - timestamp) / MINUTE_MS);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}
