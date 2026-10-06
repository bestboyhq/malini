import { describe, expect, it } from 'vitest';

import {
	FreshSubmissionIntentLatch,
	resolveSubmissionSessionTarget,
	shouldForceFreshSessionAfterQueuedTurn,
} from './submission-session-target';

describe('resolveSubmissionSessionTarget', () => {
	it('keeps an older captured chat instead of a newer same-selection sibling after navigating away', () => {
		const target = resolveSubmissionSessionTarget({
			workstreamId: 'workstream-a',
			capturedSessionId: 'a-older-selected',
			forceFreshSession: false,
			candidates: [
				{
					id: 'a-newer-sibling',
					workstreamId: 'workstream-a',
					startedAt: '2026-07-17T12:01:00.000Z',
					matchesTurn: true,
					busy: false,
				},
				{
					id: 'a-older-selected',
					workstreamId: 'workstream-a',
					startedAt: '2026-07-17T12:00:00.000Z',
					matchesTurn: true,
					busy: false,
				},
				{
					id: 'b-current-route',
					workstreamId: 'workstream-b',
					startedAt: '2026-07-17T12:02:00.000Z',
					matchesTurn: true,
					busy: false,
				},
			],
		});

		expect(target).toEqual({
			targetSessionId: 'a-older-selected',
			queueTargetSessionId: 'a-older-selected',
			targetIsBusy: false,
			fallbackSessionId: 'a-newer-sibling',
		});
	});

	it('does not block an idle selected chat behind an unrelated busy sibling', () => {
		const target = resolveSubmissionSessionTarget({
			workstreamId: 'workstream-a',
			capturedSessionId: 'selected-idle',
			forceFreshSession: false,
			candidates: [
				{
					id: 'unrelated-running',
					workstreamId: 'workstream-a',
					startedAt: '2026-07-17T12:02:00.000Z',
					matchesTurn: false,
					busy: true,
				},
				{
					id: 'selected-idle',
					workstreamId: 'workstream-a',
					startedAt: '2026-07-17T12:00:00.000Z',
					matchesTurn: true,
					busy: false,
				},
			],
		});

		expect(target.targetSessionId).toBe('selected-idle');
		expect(target.targetIsBusy).toBe(false);
	});

	it('returns the resolved busy chat as the exact affinity to persist', () => {
		const target = resolveSubmissionSessionTarget({
			workstreamId: 'workstream-a',
			capturedSessionId: null,
			forceFreshSession: false,
			candidates: [
				{
					id: 'minted-by-the-previous-rapid-send',
					workstreamId: 'workstream-a',
					startedAt: '2026-07-17T12:02:00.000Z',
					matchesTurn: true,
					busy: true,
				},
			],
		});

		expect(target).toMatchObject({
			targetSessionId: 'minted-by-the-previous-rapid-send',
			queueTargetSessionId: 'minted-by-the-previous-rapid-send',
			targetIsBusy: true,
		});
	});

	it('waits for the captured running chat before minting an explicit model fork', () => {
		const target = resolveSubmissionSessionTarget({
			workstreamId: 'workstream-a',
			capturedSessionId: 'selected-running',
			forceFreshSession: true,
			candidates: [
				{
					id: 'selected-running',
					workstreamId: 'workstream-a',
					startedAt: '2026-07-17T12:00:00.000Z',
					matchesTurn: false,
					busy: true,
				},
				{
					id: 'unrelated-idle',
					workstreamId: 'workstream-a',
					startedAt: '2026-07-17T12:01:00.000Z',
					matchesTurn: true,
					busy: false,
				},
			],
		});

		expect(target.targetSessionId).toBeNull();
		expect(target.queueTargetSessionId).toBe('selected-running');
		expect(target.targetIsBusy).toBe(true);
	});

	it('falls back to the newest matching workstream chat when the captured id is invalid', () => {
		const target = resolveSubmissionSessionTarget({
			workstreamId: 'workstream-a',
			capturedSessionId: 'workstream-b-chat',
			forceFreshSession: false,
			candidates: [
				{
					id: 'workstream-b-chat',
					workstreamId: 'workstream-b',
					startedAt: '2026-07-17T12:03:00.000Z',
					matchesTurn: true,
					busy: false,
				},
				{
					id: 'a-matching-newest',
					workstreamId: 'workstream-a',
					startedAt: '2026-07-17T12:02:00.000Z',
					matchesTurn: true,
					busy: false,
				},
				{
					id: 'a-nonmatching',
					workstreamId: 'workstream-a',
					startedAt: '2026-07-17T12:01:00.000Z',
					matchesTurn: false,
					busy: false,
				},
			],
		});

		expect(target.targetSessionId).toBe('a-matching-newest');
		expect(target.queueTargetSessionId).toBe('a-matching-newest');
		expect(target.fallbackSessionId).toBe('a-matching-newest');
	});

	it('claims a rapid fresh intent once, then reuses the session minted by the first turn', () => {
		const latch = new FreshSubmissionIntentLatch();
		const firstForceFresh = latch.claim(true, 'workstream-a:planning:claude:opus');
		const secondForceFresh = latch.claim(true, 'workstream-a:planning:claude:opus');

		const first = resolveSubmissionSessionTarget({
			workstreamId: 'workstream-a',
			capturedSessionId: null,
			forceFreshSession: firstForceFresh,
			candidates: [],
		});
		const second = resolveSubmissionSessionTarget({
			workstreamId: 'workstream-a',
			capturedSessionId: null,
			forceFreshSession: secondForceFresh,
			candidates: [
				{
					id: 'minted-by-first-turn',
					workstreamId: 'workstream-a',
					startedAt: '2026-07-17T12:00:00.000Z',
					matchesTurn: true,
					busy: true,
				},
			],
		});

		expect(first.targetSessionId).toBeNull();
		expect(firstForceFresh).toBe(true);
		expect(secondForceFresh).toBe(false);
		expect(second).toMatchObject({
			targetSessionId: 'minted-by-first-turn',
			targetIsBusy: true,
		});
	});

	it('claims each distinct model fork even when UI propagation has not reset the latch', () => {
		const latch = new FreshSubmissionIntentLatch();
		expect(latch.claim(true, 'workstream-a:planning:claude:opus')).toBe(true);
		expect(latch.claim(true, 'workstream-a:implementation:claude:sonnet')).toBe(true);
		expect(latch.claim(true, 'workstream-a:planning:claude:opus')).toBe(true);
	});

	it('promotes each queued Plan/Build transition to its own fresh chat boundary', () => {
		const plan = { role: 'planning', provider: 'claude', model: 'claude-opus-4-8' };
		const build = {
			role: 'implementation',
			provider: 'claude',
			model: 'claude-sonnet-4-6',
		};

		expect(
			shouldForceFreshSessionAfterQueuedTurn({
				requested: false,
				previousQueuedTurn: plan,
				nextTurn: build,
			}),
		).toBe(true);
		expect(
			shouldForceFreshSessionAfterQueuedTurn({
				requested: false,
				previousQueuedTurn: build,
				nextTurn: plan,
			}),
		).toBe(true);
		expect(
			shouldForceFreshSessionAfterQueuedTurn({
				requested: false,
				previousQueuedTurn: plan,
				nextTurn: plan,
			}),
		).toBe(false);
	});
});
