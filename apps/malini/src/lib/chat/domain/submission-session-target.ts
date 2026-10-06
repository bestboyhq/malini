export type SubmissionSessionCandidate<TSessionId extends string = string> = Readonly<{
	id: TSessionId;
	workstreamId: string;
	startedAt: string;
	matchesTurn: boolean;
	busy: boolean;
}>;

export type SubmissionSessionTarget<TSessionId extends string = string> = Readonly<{
	targetSessionId: TSessionId | null;
	queueTargetSessionId: TSessionId | null;
	targetIsBusy: boolean;
	fallbackSessionId: TSessionId | null;
}>;

export type QueuedSubmissionSelection = Readonly<{
	role: string;
	model: string;
}>;

export function shouldForceFreshSessionAfterQueuedTurn(input: {
	requested: boolean;
	previousQueuedTurn: QueuedSubmissionSelection | null;
	nextTurn: QueuedSubmissionSelection;
}): boolean {
	if (input.requested) return true;
	const previous = input.previousQueuedTurn;
	return Boolean(
		previous && (previous.role !== input.nextTurn.role || previous.model !== input.nextTurn.model),
	);
}

export function resolveSubmissionSessionTarget<TSessionId extends string>(input: {
	workstreamId: string;
	capturedSessionId: TSessionId | null;
	forceFreshSession: boolean;
	candidates: readonly SubmissionSessionCandidate<TSessionId>[];
}): SubmissionSessionTarget<TSessionId> {
	const workstreamCandidates = input.candidates
		.filter(({ workstreamId }) => workstreamId === input.workstreamId)
		.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
	const capturedWorkstreamSession = input.capturedSessionId
		? (workstreamCandidates.find(({ id }) => id === input.capturedSessionId) ?? null)
		: null;
	if (input.forceFreshSession) {
		return {
			targetSessionId: null,
			queueTargetSessionId: capturedWorkstreamSession?.id ?? null,
			targetIsBusy: capturedWorkstreamSession?.busy ?? false,
			fallbackSessionId: workstreamCandidates[0]?.id ?? null,
		};
	}
	const captured = capturedWorkstreamSession?.matchesTurn ? capturedWorkstreamSession : null;
	const target = captured ?? workstreamCandidates.find(({ matchesTurn }) => matchesTurn) ?? null;

	return {
		targetSessionId: target?.id ?? null,
		queueTargetSessionId: target?.id ?? null,
		targetIsBusy: target?.busy ?? false,
		fallbackSessionId: workstreamCandidates[0]?.id ?? null,
	};
}

export class FreshSubmissionIntentLatch {
	#claimedKey: string | null = null;

	claim(requested: boolean, key: string): boolean {
		if (!requested) {
			this.#claimedKey = null;
			return false;
		}
		if (this.#claimedKey === key) return false;
		this.#claimedKey = key;
		return true;
	}

	reset(): void {
		this.#claimedKey = null;
	}
}
