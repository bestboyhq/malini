import { describe, expect, it } from 'vitest';
import { routeWorkstreamSubmission } from './submission-routing';

describe('routeWorkstreamSubmission', () => {
	it('dispatches when the chat and the workstream slot are both free', () => {
		expect(
			routeWorkstreamSubmission({
				targetIsBusy: false,
				targetQueuedTurns: 0,
				blocker: null,
			}),
		).toEqual({ kind: 'dispatch' });
	});

	it('queues behind the chat own backlog without touching a sibling', () => {
		expect(
			routeWorkstreamSubmission({
				targetIsBusy: false,
				targetQueuedTurns: 1,
				blocker: null,
			}),
		).toEqual({ kind: 'queue', preemptSessionId: null });
	});

	it('queues when the chat is busy even while a sibling waits for the user', () => {
		expect(
			routeWorkstreamSubmission({
				targetIsBusy: true,
				targetQueuedTurns: 0,
				blocker: { sessionId: 'sess-a', waitingForUser: true },
			}),
		).toEqual({ kind: 'queue', preemptSessionId: null });
	});

	it('queues behind a sibling that is actively running', () => {
		expect(
			routeWorkstreamSubmission({
				targetIsBusy: false,
				targetQueuedTurns: 0,
				blocker: { sessionId: 'sess-a', waitingForUser: false },
			}),
		).toEqual({ kind: 'queue', preemptSessionId: null });
	});

	it('preempts a sibling whose run is only waiting for the user', () => {
		expect(
			routeWorkstreamSubmission({
				targetIsBusy: false,
				targetQueuedTurns: 0,
				blocker: { sessionId: 'sess-a', waitingForUser: true },
			}),
		).toEqual({ kind: 'queue', preemptSessionId: 'sess-a' });
	});

	it('ignores a sibling backlog when this chat has none of its own', () => {
		expect(
			routeWorkstreamSubmission({
				targetIsBusy: false,
				targetQueuedTurns: 0,
				blocker: null,
			}),
		).toEqual({ kind: 'dispatch' });
	});
});
