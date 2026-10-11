import { isCancellationError } from '$contract/agent-state-machine';
import type { AgentEvent } from './events';
import { parseTurnReport, type TurnReportImage } from './turn-report';

export type AgentAttentionKind = 'completed' | 'input' | 'failed' | 'approval';

export type AgentAttention = {
	kind: AgentAttentionKind;
	runId: string;
	sessionId?: string;
	updatedAt: number;
	body?: string;
	outcome?: string;
	needs?: readonly string[];
	images?: readonly TurnReportImage[];
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

export function attentionNeedsUser(attention: AgentAttention | null): boolean {
	return attention !== null && attention.kind !== 'completed';
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
		const run = {
			runId: input.runId,
			...(input.sessionId ? { sessionId: input.sessionId } : {}),
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
		const turn = { ...run, outcome: report.outcome, needs: report.needs, images: report.images };
		const firstNeed = report.needs[0];
		if (firstNeed) {
			return {
				kind: 'input',
				...turn,
				title: `${input.workstreamLabel} needs you`,
				body: compact(firstNeed),
			};
		}
		return {
			kind: 'completed',
			...turn,
			title: `${input.workstreamLabel} finished`,
			body: compact(report.outcome),
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

const ATTENTION_KINDS: readonly AgentAttentionKind[] = ['completed', 'input', 'failed', 'approval'];

export function readAgentAttentions(value: unknown): Record<string, AgentAttention> {
	if (!isRecord(value)) return {};
	const attentions: Record<string, AgentAttention> = {};
	for (const [workstreamId, candidate] of Object.entries(value)) {
		const attention = readAgentAttention(candidate);
		if (workstreamId && attention) attentions[workstreamId] = attention;
	}
	return attentions;
}

function readAgentAttention(value: unknown): AgentAttention | null {
	if (!isRecord(value)) return null;
	const { kind, runId, sessionId, updatedAt, body, outcome, needs, images } = value;
	const knownKind = ATTENTION_KINDS.find((candidate) => candidate === kind);
	if (!knownKind || typeof runId !== 'string' || typeof updatedAt !== 'number') return null;
	return {
		kind: knownKind,
		runId,
		updatedAt,
		...(typeof sessionId === 'string' ? { sessionId } : {}),
		...(typeof body === 'string' ? { body } : {}),
		...(typeof outcome === 'string' ? { outcome } : {}),
		...(Array.isArray(needs)
			? { needs: needs.filter((need): need is string => typeof need === 'string') }
			: {}),
		...(Array.isArray(images)
			? {
					images: images.filter(
						(image): image is TurnReportImage =>
							isRecord(image) &&
							typeof image['src'] === 'string' &&
							typeof image['alt'] === 'string',
					),
				}
			: {}),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
