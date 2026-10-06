export type WorkstreamRunBlocker<TSessionId extends string = string> = Readonly<{
	sessionId: TSessionId;
	waitingForUser: boolean;
}>;

export type WorkstreamSubmissionRoute<TSessionId extends string = string> =
	| { readonly kind: 'dispatch' }
	| { readonly kind: 'queue'; readonly preemptSessionId: TSessionId | null };

export function routeWorkstreamSubmission<TSessionId extends string>(input: {
	targetIsBusy: boolean;
	targetQueuedTurns: number;
	blocker: WorkstreamRunBlocker<TSessionId> | null;
}): WorkstreamSubmissionRoute<TSessionId> {
	if (input.targetIsBusy || input.targetQueuedTurns > 0) {
		return { kind: 'queue', preemptSessionId: null };
	}
	if (!input.blocker) return { kind: 'dispatch' };
	return {
		kind: 'queue',
		preemptSessionId: input.blocker.waitingForUser ? input.blocker.sessionId : null,
	};
}
