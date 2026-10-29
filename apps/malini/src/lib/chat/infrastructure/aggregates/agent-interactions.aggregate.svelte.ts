import type {
	AgentApprovalDecision,
	AgentApprovalScope,
	AgentPermissionDescriptor,
	AgentQuestion,
	AgentQuestionAnswer,
	AgentQuestionRequest,
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
import type { AgentEvent, EventEnvelope } from '$lib/chat/domain/events';
import { agentInteractions } from '$lib/chat/infrastructure/services/agent-interactions.service';
import { agentActivity } from './agent-activity.aggregate.svelte';
import { sessionsAggregate } from './sessions.aggregate.svelte';

type InteractionAgentPort = Readonly<{
	decideAgentApproval(input: DecideAgentApprovalInput): Promise<DecideAgentApprovalResult>;
	answerAgentQuestion(input: AnswerAgentQuestionInput): Promise<void>;
}>;

type RegisteredApproval = Readonly<{
	kind: 'approval';
	sessionId: string;
	runId: string;
	requestId: string;
	permission?: AgentPermissionDescriptor;
	autoModeRule?: string;
	autoModeUnavailable?: true;
}>;

type RegisteredInteraction =
	| RegisteredApproval
	| Readonly<{
			kind: 'question';
			sessionId: string;
			runId: string;
			requestId: string;
			questions: readonly AgentQuestion[];
	  }>;

const IDLE_STATE = Object.freeze({ status: 'idle' }) satisfies AgentInteractionState;
const SCOPE_MESSAGES = {
	session: 'Allowed for this chat',
	workstream: 'Allowed for this workstream',
	everywhere: 'Allowed everywhere',
} as const;
const STALE_MESSAGE = 'No longer active';
const ANSWERED_STATE = Object.freeze({
	status: 'resolved',
	message: 'Answered',
}) satisfies AgentInteractionState;

function runKey(sessionId: string, runId: string): string {
	return `${sessionId}:${runId}`;
}

function appendsWithoutInteractionLifecycle(
	previous: readonly EventEnvelope[],
	next: readonly EventEnvelope[],
): boolean {
	if (next.length < previous.length) return false;
	if (previous.length > 0 && next[0] !== previous[0]) return false;
	if (next[previous.length - 1] !== previous[previous.length - 1]) return false;
	for (let index = previous.length; index < next.length; index += 1) {
		const type = next[index]?.event.type;
		if (
			type === 'approval.requested' ||
			type === 'approval.decided' ||
			type === 'question.requested' ||
			type === 'run.completed' ||
			type === 'run.failed'
		) {
			return false;
		}
	}
	return true;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim()) return error.message.trim();
	if (typeof error === 'string' && error.trim()) return error.trim();
	return 'Could not send this response. Try again.';
}

export class AgentInteractionCommands {
	states = $state<Record<string, AgentInteractionState>>({});
	#requests = $state.raw(new Map<string, RegisteredInteraction>());
	#syncedBySession = new Map<string, readonly EventEnvelope[]>();
	#resolveAgentPort: () => InteractionAgentPort;
	#onResolved: (sessionId: string, runId: string) => void;

	constructor(
		resolveAgentPort: () => InteractionAgentPort = () => agentInteractions,
		onResolved: (sessionId: string, runId: string) => void = (sessionId, runId) => {
			sessionsAggregate.resumeRunAfterInteraction(sessionId, runId);
			agentActivity.clearForRun(sessionId, runId);
		},
	) {
		this.#resolveAgentPort = resolveAgentPort;
		this.#onResolved = onResolved;
	}

	sync(envelopes: readonly EventEnvelope[]): void {
		this.#syncedBySession.clear();
		this.#sync(envelopes);
	}

	syncSession(sessionId: string, envelopes: readonly EventEnvelope[]): void {
		const previous = this.#syncedBySession.get(sessionId);
		this.#syncedBySession.set(sessionId, envelopes);
		if (previous && appendsWithoutInteractionLifecycle(previous, envelopes)) return;
		this.#sync(envelopes, sessionId);
	}

	#sync(envelopes: readonly EventEnvelope[], sessionId?: string): void {
		const requests = new Map<string, RegisteredInteraction>();
		const terminalRuns = new Set<string>();
		const invalid = new Map<string, string>();
		const answeredToolCalls = new Set<string>();
		const questionToolCalls = new Map<string, string>();
		const decisions = new Map<string, ApprovalDecided>();

		for (const envelope of envelopes) {
			if (sessionId !== undefined && envelope.sessionId !== sessionId) continue;
			const event = envelope.event;
			if (event.type === 'run.completed' || event.type === 'run.failed') {
				terminalRuns.add(runKey(envelope.sessionId, envelope.runId));
				continue;
			}
			if (event.type === 'approval.decided') {
				const reference = {
					kind: 'approval',
					sessionId: envelope.sessionId,
					runId: envelope.runId,
					requestId: event.approvalId,
				} satisfies AgentInteractionReference;
				decisions.set(agentInteractionKey(reference), event);
				continue;
			}
			if (event.type === 'tool.completed' && event.toolCallId) {
				answeredToolCalls.add(runKey(envelope.runId, event.toolCallId));
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
					...(event.autoModeRule ? { autoModeRule: event.autoModeRule } : {}),
					...(event.autoModeUnavailable ? { autoModeUnavailable: true } : {}),
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
				if (event.toolCallId) questionToolCalls.set(key, runKey(envelope.runId, event.toolCallId));
			}
		}

		const nextStates = { ...this.states };
		for (const [key, message] of invalid) {
			requests.delete(key);
			if (nextStates[key]?.status !== 'resolved') nextStates[key] = { status: 'stale', message };
		}
		for (const [key, request] of requests) {
			const current = nextStates[key];
			const toolCall = questionToolCalls.get(key);
			const decided = decisions.get(key);
			if (decided && request.kind === 'approval') {
				if (current?.status !== 'resolved') nextStates[key] = decidedState(decided, request);
			} else if (toolCall && answeredToolCalls.has(toolCall)) {
				if (current?.status !== 'resolved') nextStates[key] = ANSWERED_STATE;
			} else if (terminalRuns.has(runKey(request.sessionId, request.runId))) {
				if (current?.status !== 'resolved' && current?.status !== 'submitting') {
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

	pendingQuestions(sessionId: string): readonly AgentQuestionRequest[] {
		const pending: AgentQuestionRequest[] = [];
		for (const [key, request] of this.#requests) {
			if (request.kind !== 'question' || request.sessionId !== sessionId) continue;
			const state = this.states[key] ?? IDLE_STATE;
			if (state.status === 'resolved' || state.status === 'stale') continue;
			pending.push({
				sessionId,
				runId: request.runId,
				questionId: request.requestId,
				questions: request.questions,
				submitting: state.status === 'submitting',
				error: state.status === 'error' ? state.message : null,
			});
		}
		return pending;
	}

	stateFor(reference: AgentInteractionReference): AgentInteractionState {
		const key = agentInteractionKey(reference);
		return (
			this.states[key] ??
			(this.#requests.has(key) ? IDLE_STATE : { status: 'stale', message: STALE_MESSAGE })
		);
	}

	#resolved(key: string, sessionId: string, runId: string): void {
		const othersWait = [...this.#requests].some(([other, request]) => {
			if (other === key || request.sessionId !== sessionId || request.runId !== runId) return false;
			const { status } = this.states[other] ?? IDLE_STATE;
			return status !== 'resolved' && status !== 'stale';
		});
		if (!othersWait) this.#onResolved(sessionId, runId);
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
			!(['once', 'session', 'workstream', 'everywhere'] as const).includes(input.scope)
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
		const autoModeRule = request?.kind === 'approval' ? request.autoModeRule : undefined;
		const keptBlockedRunsOn = request?.kind === 'approval' && runsOnWhenKeptBlocked(request);
		const alwaysAllow = input.alwaysAllow === true;
		if (alwaysAllow && (input.decision !== 'allow' || input.scope !== 'once' || !autoModeRule)) {
			this.#fail(key, 'Only a call auto mode blocked can be always allowed.');
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
				...(input.updatedInput ? { updatedInput: input.updatedInput } : {}),
				...(alwaysAllow ? { alwaysAllow } : {}),
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
			if (input.decision === 'allow' || keptBlockedRunsOn) {
				this.#resolved(key, input.sessionId, input.runId);
			}
			const remembered = input.decision === 'allow' && result.remembered;
			this.states = {
				...this.states,
				[key]: {
					status: 'resolved',
					message: resolvedMessage(
						{
							decision: input.decision,
							scope: input.scope,
							alwaysAllow,
							reviewed: input.updatedInput !== undefined,
						},
						remembered,
						keptBlockedRunsOn,
					),
					decision: input.decision,
					requestedScope: input.scope,
					scopeStored: remembered,
					...(alwaysAllow ? { alwaysAllowed: true } : {}),
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
			this.#resolved(key, input.sessionId, input.runId);
			this.states = { ...this.states, [key]: ANSWERED_STATE };
			return true;
		} catch (error) {
			if (this.states[key]?.status === 'stale') return false;
			this.#fail(key, errorMessage(error));
			return false;
		}
	}

	reset(): void {
		this.#syncedBySession.clear();
		this.#requests = new Map();
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

type ApprovalDecided = Extract<AgentEvent, { type: 'approval.decided' }>;

type Decision = Readonly<{
	decision: AgentApprovalDecision;
	scope: AgentApprovalScope;
	alwaysAllow?: boolean;
	reviewed?: boolean;
}>;

function runsOnWhenKeptBlocked(request: RegisteredApproval): boolean {
	return request.autoModeRule !== undefined || request.autoModeUnavailable === true;
}

function decidedState(
	decided: ApprovalDecided,
	request: RegisteredApproval,
): AgentInteractionState {
	const remembered = decided.decision === 'allow' && decided.remembered;
	return {
		status: 'resolved',
		message: resolvedMessage(decided, remembered, runsOnWhenKeptBlocked(request)),
		decision: decided.decision,
		requestedScope: decided.scope,
		scopeStored: remembered,
		...(decided.alwaysAllow ? { alwaysAllowed: true } : {}),
	};
}

function resolvedMessage(
	decided: Decision,
	remembered: boolean,
	keptBlockedRunsOn: boolean,
): string {
	if (decided.decision === 'deny') return keptBlockedRunsOn ? 'Kept blocked' : 'Denied';
	if (decided.alwaysAllow) return 'Always allowed';
	if (decided.reviewed) return 'Saved after review';
	if (decided.scope === 'once' || !remembered) return 'Allowed once';
	return SCOPE_MESSAGES[decided.scope];
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
