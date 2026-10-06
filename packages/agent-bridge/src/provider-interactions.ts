import type {
	AgentQuestion,
	ProviderApprovalReply,
	ProviderApprovalRequest,
	ProviderApprovalResolution,
	ProviderInteractionRequester,
	ProviderQuestionReply,
	ProviderQuestionRequest,
	ProviderQuestionResolution,
} from './interaction-types.js';
import type { AgentEvent } from './types.js';

export class ProviderInteractionError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(`${code}: ${message}`);
		this.name = 'ProviderInteractionError';
	}
}

type PendingApproval = {
	readonly kind: 'approval';
	readonly id: string;
	readonly runId: string;
	readonly promise: Promise<ProviderApprovalResolution>;
	readonly resolve: (resolution: ProviderApprovalResolution) => void;
	dispose(): void;
};

type PendingQuestion = {
	readonly kind: 'question';
	readonly id: string;
	readonly runId: string;
	readonly questions: readonly AgentQuestion[];
	readonly promise: Promise<ProviderQuestionResolution>;
	readonly resolve: (resolution: ProviderQuestionResolution) => void;
	dispose(): void;
};

type PendingInteraction = PendingApproval | PendingQuestion;

export class ProviderInteractionBroker implements ProviderInteractionRequester {
	readonly #sessionId: string;
	readonly #emit: (event: AgentEvent) => void;
	readonly #pending = new Map<string, PendingInteraction>();
	#closedReason: string | null = null;

	constructor(options: { sessionId: string; emit: (event: AgentEvent) => void }) {
		this.#sessionId = options.sessionId;
		this.#emit = options.emit;
	}

	requestApproval(request: ProviderApprovalRequest): Promise<ProviderApprovalResolution> {
		const existing = this.#existing(request.approvalId, 'approval', request.runId);
		if (existing) return existing.promise;
		if (this.#closedReason || request.signal?.aborted) {
			return Promise.resolve(this.#denied(request, this.#closedReason ?? 'request-aborted'));
		}
		let resolve!: (resolution: ProviderApprovalResolution) => void;
		const pending: PendingApproval = {
			kind: 'approval',
			id: request.approvalId,
			runId: request.runId,
			promise: new Promise((settle) => {
				resolve = settle;
			}),
			resolve: (resolution) => resolve(resolution),
			dispose: () => undefined,
		};
		pending.dispose = listenForAbort(request.signal, () => {
			this.#settleApproval(pending, this.#denied(request, 'request-aborted'));
		});
		this.#pending.set(pending.id, pending);
		this.#emit({
			type: 'approval.requested',
			sessionId: this.#sessionId,
			runId: request.runId,
			approvalId: request.approvalId,
			reason: request.reason,
			...(request.toolName ? { toolName: request.toolName } : {}),
			...(request.input !== undefined ? { input: request.input } : {}),
			...(request.permission ? { permission: request.permission } : {}),
		});
		return pending.promise;
	}

	requestQuestion(request: ProviderQuestionRequest): Promise<ProviderQuestionResolution> {
		const existing = this.#existing(request.questionId, 'question', request.runId);
		if (existing) return existing.promise;
		if (this.#closedReason || request.signal?.aborted) {
			return Promise.resolve({
				behavior: 'cancelled',
				reason: this.#closedReason ?? 'request-aborted',
			});
		}
		let resolve!: (resolution: ProviderQuestionResolution) => void;
		const pending: PendingQuestion = {
			kind: 'question',
			id: request.questionId,
			runId: request.runId,
			questions: request.questions,
			promise: new Promise((settle) => {
				resolve = settle;
			}),
			resolve: (resolution) => resolve(resolution),
			dispose: () => undefined,
		};
		pending.dispose = listenForAbort(request.signal, () => {
			this.#settleQuestion(pending, { behavior: 'cancelled', reason: 'request-aborted' });
		});
		this.#pending.set(pending.id, pending);
		this.#emit({
			type: 'question.requested',
			sessionId: this.#sessionId,
			runId: request.runId,
			questionId: request.questionId,
			questions: request.questions,
			...(request.toolName ? { toolName: request.toolName } : {}),
			...(request.toolCallId ? { toolCallId: request.toolCallId } : {}),
		});
		return pending.promise;
	}

	resolveApproval(reply: ProviderApprovalReply): void {
		this.#assertSession(reply.sessionId);
		const pending = this.#pendingFor(reply.approvalId, 'approval', reply.runId);
		this.#settleApproval(pending, reply);
	}

	resolveQuestion(reply: ProviderQuestionReply): void {
		this.#assertSession(reply.sessionId);
		const pending = this.#pendingFor(reply.questionId, 'question', reply.runId);
		validateAnswers(pending.questions, reply);
		this.#settleQuestion(pending, { behavior: 'answered', reply });
	}

	cancelRun(runId: string, reason = 'run-cancelled'): void {
		for (const pending of [...this.#pending.values()]) {
			if (pending.runId !== runId) continue;
			if (pending.kind === 'approval') {
				this.#settleApproval(pending, {
					sessionId: this.#sessionId,
					runId,
					approvalId: pending.id,
					decision: 'deny',
					scope: 'once',
					reason,
				});
			} else {
				this.#settleQuestion(pending, { behavior: 'cancelled', reason });
			}
		}
	}

	close(reason = 'session-closed'): void {
		if (this.#closedReason) return;
		this.#closedReason = reason;
		for (const runId of new Set([...this.#pending.values()].map((pending) => pending.runId))) {
			this.cancelRun(runId, reason);
		}
	}

	#existing(id: string, kind: 'approval', runId: string): PendingApproval | null;
	#existing(id: string, kind: 'question', runId: string): PendingQuestion | null;
	#existing(
		id: string,
		kind: PendingInteraction['kind'],
		runId: string,
	): PendingInteraction | null {
		const pending = this.#pending.get(id);
		if (!pending) return null;
		if (pending.kind !== kind || pending.runId !== runId) {
			throw new ProviderInteractionError(
				'INTERACTION_REQUEST_COLLISION',
				`${id} is already pending for ${pending.kind} on run ${pending.runId}`,
			);
		}
		return pending;
	}

	#pendingFor(id: string, kind: 'approval', runId: string): PendingApproval;
	#pendingFor(id: string, kind: 'question', runId: string): PendingQuestion;
	#pendingFor(id: string, kind: PendingInteraction['kind'], runId: string): PendingInteraction {
		const pending = this.#pending.get(id);
		if (!pending) {
			throw new ProviderInteractionError(
				'INTERACTION_REQUEST_NOT_FOUND',
				`no pending ${kind} ${id}`,
			);
		}
		if (pending.kind !== kind) {
			throw new ProviderInteractionError(
				'INTERACTION_REQUEST_KIND_MISMATCH',
				`${id} is ${pending.kind}, not ${kind}`,
			);
		}
		if (pending.runId !== runId) {
			throw new ProviderInteractionError(
				'INTERACTION_RUN_MISMATCH',
				`${id} belongs to run ${pending.runId}, not ${runId}`,
			);
		}
		return pending;
	}

	#assertSession(sessionId: string): void {
		if (sessionId === this.#sessionId) return;
		throw new ProviderInteractionError(
			'INTERACTION_SESSION_MISMATCH',
			`reply belongs to session ${sessionId}, not ${this.#sessionId}`,
		);
	}

	#settleApproval(pending: PendingApproval, resolution: ProviderApprovalResolution): void {
		if (!this.#takePending(pending)) return;
		pending.resolve(resolution);
	}

	#settleQuestion(pending: PendingQuestion, resolution: ProviderQuestionResolution): void {
		if (!this.#takePending(pending)) return;
		pending.resolve(resolution);
	}

	#takePending(pending: PendingInteraction): boolean {
		if (this.#pending.get(pending.id) !== pending) return false;
		this.#pending.delete(pending.id);
		pending.dispose();
		return true;
	}

	#denied(
		request: Pick<ProviderApprovalRequest, 'runId' | 'approvalId'>,
		reason: string,
	): ProviderApprovalResolution {
		return {
			sessionId: this.#sessionId,
			runId: request.runId,
			approvalId: request.approvalId,
			decision: 'deny',
			scope: 'once',
			reason,
		};
	}
}

function listenForAbort(signal: AbortSignal | undefined, onAbort: () => void): () => void {
	if (!signal) return () => undefined;
	signal.addEventListener('abort', onAbort, { once: true });
	return () => signal.removeEventListener('abort', onAbort);
}

function validateAnswers(questions: readonly AgentQuestion[], reply: ProviderQuestionReply): void {
	const expected = new Set(questions.map((question) => question.id));
	const answered = new Set(reply.answers.map((answer) => answer.questionId));
	if (
		expected.size !== questions.length ||
		answered.size !== reply.answers.length ||
		expected.size !== answered.size ||
		[...expected].some((id) => !answered.has(id))
	) {
		throw new ProviderInteractionError(
			'QUESTION_ANSWER_MISMATCH',
			`answers do not match questions for ${reply.questionId}`,
		);
	}
}
