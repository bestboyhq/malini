import { isCancellationError } from '$contract/agent-state-machine';
import type { AgentEvent } from './events';
import { parseTurnReport } from './turn-report';
import type { SoundSignal } from '$shared/sounds/domain/sounds';

export type AgentAttentionKind = 'completed' | 'input' | 'failed' | 'approval';

export type AgentAttention = {
	kind: AgentAttentionKind;
	runId: string;
	sessionId: string;
	updatedAt: number;
};

export type AgentAttentionDecision = AgentAttention & {
	title: string;
	body: string;
};

export type AgentWorkstreamLead = Readonly<{ workstreamId: string; label: string }>;

export type AgentWorkstreamContext = {
	workstreamId: string;
	label: string;
	repositoryFullName: string;
	branch: string;
	lead: AgentWorkstreamLead | null;
};

type AgentAttentionInput = {
	event: AgentEvent;
	runId: string;
	sessionId: string;
	queueCount: number;
	workstreamLabel: string;
	repositoryFullName: string;
	branch: string;
	now?: number;
};

export function attentionNeedsUser(attention: AgentAttention | null): boolean {
	return attention !== null && attention.kind !== 'completed';
}

export function attentionSoundSignal(kind: AgentAttentionKind): SoundSignal {
	return kind === 'completed' ? 'finished' : 'needs-you';
}

export function mostPressingAttention(
	attentions: readonly AgentAttention[],
): AgentAttention | null {
	let pressing: AgentAttention | null = null;
	for (const attention of attentions) {
		if (!pressing || pressesHarder(attention, pressing)) pressing = attention;
	}
	return pressing;
}

function pressesHarder(candidate: AgentAttention, current: AgentAttention): boolean {
	const candidateNeedsUser = attentionNeedsUser(candidate);
	if (candidateNeedsUser !== attentionNeedsUser(current)) return candidateNeedsUser;
	return candidate.updatedAt > current.updatedAt;
}

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
			sessionId: input.sessionId,
			updatedAt,
			title: `${input.workstreamLabel} is waiting`,
			body: compact(requestText) || context || 'Input required',
		};
	}

	if (input.event.type === 'run.completed') {
		if (input.queueCount > 0 || input.event.handedOff) return null;
		const run = {
			runId: input.runId,
			sessionId: input.sessionId,
			updatedAt,
		};
		const report = parseTurnReport(input.event.summary);
		if (report.outcome === null) {
			return {
				kind: 'completed',
				...run,
				title: `${input.workstreamLabel} finished`,
				body: compact(input.event.summary) || context || 'Ready for review',
			};
		}
		const firstNeed = report.needs[0];
		if (firstNeed) {
			return {
				kind: 'input',
				...run,
				title: `${input.workstreamLabel} needs you`,
				body: compact(firstNeed),
			};
		}
		return {
			kind: 'completed',
			...run,
			title: `${input.workstreamLabel} finished`,
			body: compact(report.outcome),
		};
	}

	if (input.event.type === 'run.failed') {
		if (input.queueCount > 0 || input.event.resumeAt !== undefined) return null;
		if (isExpectedCancellation(input.event.error)) return null;
		return {
			kind: 'failed',
			runId: input.runId,
			sessionId: input.sessionId,
			updatedAt,
			title: `${input.workstreamLabel} needs attention`,
			body: compact(input.event.error) || context || 'Agent run failed',
		};
	}

	return null;
}
