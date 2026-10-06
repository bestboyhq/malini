import { isCancellationError } from '$contract/agent-state-machine';
import type { AgentEvent } from './events';

export type AgentAttentionKind = 'completed' | 'failed' | 'approval';

export type AgentAttention = {
	kind: AgentAttentionKind;
	runId: string;
	sessionId?: string;
	updatedAt: number;
};

export type AgentAttentionDecision = AgentAttention & {
	title: string;
	body: string;
};

export type AgentWorkstreamContext = {
	workstreamId: string;
	label: string;
	repositoryFullName: string;
	branch: string;
};

type AgentAttentionInput = {
	event: AgentEvent;
	runId: string;
	sessionId?: string;
	activeWorkstreamId: string;
	workstreamId: string;
	appFocused: boolean;
	queueCount: number;
	workstreamLabel: string;
	repositoryFullName: string;
	branch: string;
	now?: number;
};

function compact(value: string, max = 140): string {
	const normalized = value.replace(/\s+/gu, ' ').trim();
	return normalized.length > max ? `${normalized.slice(0, max - 1).trimEnd()}…` : normalized;
}

function contextSuffix(input: AgentAttentionInput): string {
	const repository = input.repositoryFullName.trim();
	const branch = input.branch.trim();
	return [repository, branch].filter(Boolean).join(' · ');
}

function isExpectedCancellation(error: string): boolean {
	return isCancellationError(error) || /interrupted: app closed mid-run/iu.test(error);
}

export function agentAttentionDecision(input: AgentAttentionInput): AgentAttentionDecision | null {
	const userAlreadyLooking = input.workstreamId === input.activeWorkstreamId && input.appFocused;
	if (userAlreadyLooking) return null;

	const updatedAt = input.now ?? Date.now();
	const context = contextSuffix(input);
	if (input.event.type === 'approval.requested' || input.event.type === 'question.requested') {
		const requestText =
			input.event.type === 'approval.requested'
				? input.event.reason
				: (input.event.questions[0]?.prompt ?? 'Answer required');
		return {
			kind: 'approval',
			runId: input.runId,
			...(input.sessionId ? { sessionId: input.sessionId } : {}),
			updatedAt,
			title: `${input.workstreamLabel} is waiting`,
			body: compact(requestText) || context || 'Input required',
		};
	}

	if (input.event.type === 'run.completed') {
		if (input.queueCount > 0) return null;
		return {
			kind: 'completed',
			runId: input.runId,
			...(input.sessionId ? { sessionId: input.sessionId } : {}),
			updatedAt,
			title: `${input.workstreamLabel} finished`,
			body: compact(input.event.summary) || context || 'Ready for review',
		};
	}

	if (input.event.type === 'run.failed') {
		if (input.queueCount > 0 || isExpectedCancellation(input.event.error)) return null;
		return {
			kind: 'failed',
			runId: input.runId,
			...(input.sessionId ? { sessionId: input.sessionId } : {}),
			updatedAt,
			title: `${input.workstreamLabel} needs attention`,
			body: compact(input.event.error) || context || 'Agent run failed',
		};
	}

	return null;
}
