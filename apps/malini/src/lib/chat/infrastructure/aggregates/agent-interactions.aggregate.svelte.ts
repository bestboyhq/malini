import type {
	AgentPermissionDescriptor,
	AgentQuestion,
	AgentQuestionAnswer,
	AnswerAgentQuestionInput,
	DecideAgentApprovalInput,
	DecideAgentApprovalResult,
} from '$lib/chat/domain/agent-interaction';
import {
	agentInteractionKey,
	canPersistAgentApproval,
	type AgentInteractionKind,
	type AgentInteractionReference,
	type AgentInteractionState,
} from '$lib/chat/domain/agent-interaction-state';
import type { EventEnvelope } from '$lib/chat/domain/events';
import { agentInteractions } from '$lib/chat/infrastructure/services/agent-interactions.service';
import { sessionsAggregate } from './sessions.aggregate.svelte';

type InteractionAgentPort = Readonly<{
	decideAgentApproval(input: DecideAgentApprovalInput): Promise<DecideAgentApprovalResult>;
	answerAgentQuestion(input: AnswerAgentQuestionInput): Promise<void>;
}>;

type RegisteredInteraction =
	| Readonly<{
			kind: 'approval';
			sessionId: string;
			runId: string;
			requestId: string;
			permission?: AgentPermissionDescriptor;
	  }>
	| Readonly<{
			kind: 'question';
			sessionId: string;
			runId: string;
			requestId: string;
			questions: readonly AgentQuestion[];
	  }>;

const IDLE_STATE = Object.freeze({ status: 'idle' }) satisfies AgentInteractionState;
const STALE_MESSAGE = 'No longer active';

function runKey(sessionId: string, runId: string): string {
	return `${sessionId}:${runId}`;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim()) return error.message.trim();
	if (typeof error === 'string' && error.trim()) return error.trim();
	return 'Could not send this response. Try again.';
}

export class AgentInteractionCommands {
	states = $state<Record<string, AgentInteractionState>>({});
	#requests = new Map<string, RegisteredInteraction>();
	#resolveAgentPort: () => InteractionAgentPort;
	#onResolved: (sessionId: string, runId: string) => void;

	constructor(
		resolveAgentPort: () => InteractionAgentPort = () => agentInteractions,
		onResolved: (sessionId: string, runId: string) => void = (sessionId, runId) =>
			sessionsAggregate.resumeRunAfterInteraction(sessionId, runId),
	) {
		this.#resolveAgentPort = resolveAgentPort;
		this.#onResolved = onResolved;
	}

	sync(envelopes: readonly EventEnvelope[]): void {
		this.#sync(envelopes);
	}

	syncSession(sessionId: string, envelopes: readonly EventEnvelope[]): void {
		this.#sync(envelopes, sessionId);
	}

	#sync(envelopes: readonly EventEnvelope[], sessionId?: string): void {
		const requests = new Map<string, RegisteredInteraction>();
		const terminalRuns = new Set<string>();
		const invalid = new Map<string, string>();

		for (const envelope of envelopes) {
			if (sessionId !== undefined && envelope.sessionId !== sessionId) continue;
			const event = envelope.event;
			if (event.type === 'run.completed' || event.type === 'run.failed') {
				terminalRuns.add(runKey(envelope.sessionId, envelope.runId));
				continue;
			}
			if (event.type !== 'approval.requested' && event.type !== 'question.requested') continue;

			const kind = event.type === 'approval.requested' ? 'approval' : 'question';
			const requestId = event.type === 'approval.requested' ? event.approvalId : event.questionId;
			const reference = {
				kind,
				sessionId: envelope.sessionId,
				runId: envelope.runId,
				requestId,
			} satisfies AgentInteractionReference;
			const key = agentInteractionKey(reference);
			if (!requestId.trim()) {
				invalid.set(key, 'The provider returned an invalid request identifier.');
				continue;
			}
			if (
				event.runId !== envelope.runId ||
				(event.sessionId && event.sessionId !== envelope.sessionId)
			) {
				invalid.set(key, 'The provider request did not match this chat and was blocked.');
				continue;
			}
			if (requests.has(key)) continue;
			if (event.type === 'approval.requested') {
				requests.set(key, {
					kind: 'approval',
					sessionId: envelope.sessionId,
					runId: envelope.runId,
					requestId,
					...(event.permission ? { permission: event.permission } : {}),
				});
			} else {
				const questionIds = new Set(event.questions.map(({ id }) => id));
				if (
					event.questions.length === 0 ||
					questionIds.size !== event.questions.length ||
					event.questions.some(({ id, prompt, options, allowFreeText }) => {
						const optionLabels = options.map(({ label }) => label.trim()).filter(Boolean);
						return (
							!id.trim() ||
							!prompt.trim() ||
							(!allowFreeText && optionLabels.length === 0) ||
							optionLabels.length !== options.length ||
							new Set(optionLabels).size !== optionLabels.length
						);
					})
				) {
					invalid.set(key, 'The provider returned an invalid question payload.');
					continue;
				}
				requests.set(key, {
					kind: 'question',
					sessionId: envelope.sessionId,
					runId: envelope.runId,
					requestId,
					questions: event.questions,
				});
			}
		}

		const nextStates = { ...this.states };
		for (const [key, message] of invalid) {
			requests.delete(key);
			if (nextStates[key]?.status !== 'resolved') nextStates[key] = { status: 'stale', message };
		}
		for (const [key, request] of requests) {
			const current = nextStates[key];
			if (terminalRuns.has(runKey(request.sessionId, request.runId))) {
				if (current?.status !== 'resolved') {
					nextStates[key] = { status: 'stale', message: STALE_MESSAGE };
				}
			} else if (!current || current.status === 'stale') {
				nextStates[key] = IDLE_STATE;
			}
		}
		if (sessionId === undefined) {
			this.#requests = requests;
		} else {
			const nextRequests = new Map(
				[...this.#requests].filter(([, request]) => request.sessionId !== sessionId),
			);
			for (const [key, request] of requests) nextRequests.set(key, request);
			this.#requests = nextRequests;
		}
		this.states = nextStates;
	}

	stateFor(reference: AgentInteractionReference): AgentInteractionState {
		const key = agentInteractionKey(reference);
		return (
			this.states[key] ??
			(this.#requests.has(key) ? IDLE_STATE : { status: 'stale', message: STALE_MESSAGE })
		);
	}

	async decideApproval(input: DecideAgentApprovalInput): Promise<boolean> {
		const reference = {
			kind: 'approval',
			sessionId: input.sessionId,
			runId: input.runId,
			requestId: input.approvalId,
		} satisfies AgentInteractionReference;
		const key = agentInteractionKey(reference);
		if (!this.#begin(key, 'approval')) return false;
		const request = this.#requests.get(key);
		if (
			(input.decision !== 'allow' && input.decision !== 'deny') ||
			!(['once', 'session', 'workstream'] as const).includes(input.scope)
		) {
			this.#fail(key, 'Choose a valid approval decision.');
			return false;
		}
		if (
			input.decision === 'allow' &&
			input.scope !== 'once' &&
			(!request || request.kind !== 'approval' || !canPersistAgentApproval(request.permission))
		) {
			this.#fail(key, 'This permission can only be allowed once.');
			return false;
		}

		try {
			const result = await this.#resolveAgentPort().decideAgentApproval({
				sessionId: input.sessionId,
				runId: input.runId,
				approvalId: input.approvalId,
				decision: input.decision,
				scope: input.scope,
				...(request?.kind === 'approval' && request.permission
					? { permission: $state.snapshot(request.permission) }
					: {}),
			});
			if (this.states[key]?.status === 'stale') return false;
			if (result.decision !== input.decision || result.scope !== input.scope) {
				this.#fail(key, 'The approval came back for a different request.');
				return false;
			}
			if (result.remembered && (input.decision !== 'allow' || input.scope === 'once')) {
				this.#fail(key, 'The remembered approval came back malformed.');
				return false;
			}
			if (input.decision === 'allow') this.#onResolved(input.sessionId, input.runId);
			const remembered = input.decision === 'allow' && result.remembered;
			this.states = {
				...this.states,
				[key]: {
					status: 'resolved',
					message:
						input.decision === 'deny'
							? 'Denied'
							: input.scope === 'once' || !remembered
								? 'Allowed once'
								: input.scope === 'session'
									? 'Allowed for this chat'
									: 'Allowed for this workstream',
					decision: input.decision,
					requestedScope: input.scope,
					scopeStored: remembered,
					...(result.ruleId ? { ruleId: result.ruleId } : {}),
				},
			};
			return true;
		} catch (error) {
			if (this.states[key]?.status === 'stale') return false;
			this.#fail(key, errorMessage(error));
			return false;
		}
	}

	async answerQuestion(input: AnswerAgentQuestionInput): Promise<boolean> {
		const reference = {
			kind: 'question',
			sessionId: input.sessionId,
			runId: input.runId,
			requestId: input.questionId,
		} satisfies AgentInteractionReference;
		const key = agentInteractionKey(reference);
		if (!this.#begin(key, 'question')) return false;
		const request = this.#requests.get(key);
		if (!request || request.kind !== 'question') {
			this.#stale(key);
			return false;
		}
		const validation = validateQuestionAnswers(request.questions, input.answers);
		if (!validation.ok) {
			this.#fail(key, validation.message);
			return false;
		}

		try {
			await this.#resolveAgentPort().answerAgentQuestion({
				...input,
				answers: validation.answers,
			});
			if (this.states[key]?.status === 'stale') return false;
			this.#onResolved(input.sessionId, input.runId);
			this.states = {
				...this.states,
				[key]: {
					status: 'resolved',
					message: 'Answered',
				},
			};
			return true;
		} catch (error) {
			if (this.states[key]?.status === 'stale') return false;
			this.#fail(key, errorMessage(error));
			return false;
		}
	}

	reset(): void {
		this.#requests.clear();
		this.states = {};
	}

	#begin(key: string, expectedKind: AgentInteractionKind): boolean {
		const request = this.#requests.get(key);
		if (!request || request.kind !== expectedKind) {
			this.#stale(key);
			return false;
		}
		const current = this.states[key] ?? IDLE_STATE;
		if (
			current.status === 'submitting' ||
			current.status === 'resolved' ||
			current.status === 'stale'
		) {
			return false;
		}
		this.states = { ...this.states, [key]: { status: 'submitting' } };
		return true;
	}

	#fail(key: string, message: string): void {
		this.states = { ...this.states, [key]: { status: 'error', message } };
	}

	#stale(key: string): void {
		this.states = { ...this.states, [key]: { status: 'stale', message: STALE_MESSAGE } };
	}
}

type QuestionAnswerValidation =
	| Readonly<{ ok: true; answers: readonly AgentQuestionAnswer[] }>
	| Readonly<{ ok: false; message: string }>;

export function validateQuestionAnswers(
	questions: readonly AgentQuestion[],
	answers: readonly AgentQuestionAnswer[],
): QuestionAnswerValidation {
	const answerByQuestion = new Map<string, readonly string[]>();
	for (const answer of answers) {
		if (answerByQuestion.has(answer.questionId)) {
			return { ok: false, message: 'Each question must be answered once.' };
		}
		answerByQuestion.set(answer.questionId, answer.values);
	}
	if (answerByQuestion.size !== questions.length) {
		return { ok: false, message: 'Answer every question before continuing.' };
	}

	const normalized: AgentQuestionAnswer[] = [];
	for (const question of questions) {
		const rawValues = answerByQuestion.get(question.id);
		if (!rawValues) return { ok: false, message: 'Answer every question before continuing.' };
		const values = [...new Set(rawValues.map((value) => value.trim()).filter(Boolean))];
		if (values.length === 0) {
			return { ok: false, message: `Answer “${question.prompt}” before continuing.` };
		}
		if (!question.multiSelect && values.length !== 1) {
			return { ok: false, message: `Choose one answer for “${question.prompt}”.` };
		}
		const optionLabels = new Set(question.options.map(({ label }) => label));
		if (!question.allowFreeText && values.some((value) => !optionLabels.has(value))) {
			return { ok: false, message: `Choose an available answer for “${question.prompt}”.` };
		}
		normalized.push({ questionId: question.id, values });
	}
	if (
		[...answerByQuestion.keys()].some((id) => !questions.some((question) => question.id === id))
	) {
		return { ok: false, message: 'The answer no longer matches the active question.' };
	}
	return { ok: true, answers: normalized };
}

export const agentInteractionCommands = new AgentInteractionCommands();
