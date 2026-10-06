import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, EventEnvelope } from '$lib/chat/domain/events';
import type { RunId } from '$lib/chat/domain/run';
import type { SessionId } from '$lib/chat/domain/session';
import { sessionsAggregate } from './sessions.aggregate.svelte';

function env<T extends AgentEvent>(
	sessionId: SessionId,
	runId: RunId,
	seq: number,
	event: T,
): EventEnvelope {
	return { sessionId, runId, seq, event };
}

describe('SessionsAggregate', () => {
	beforeEach(() => {
		sessionsAggregate.reset();
	});

	it('idle → running on run.started and tracks currentRunId', () => {
		const sessionId = 'sess-running';
		sessionsAggregate.ensureSession({
			sessionId,
			workstreamId: 'ws-1',
			model: null,
		});

		sessionsAggregate.applyEvent(
			env(sessionId, 'run-1', 1, { type: 'run.started', runId: 'run-1', sessionId }),
		);

		const session = sessionsAggregate.getSession(sessionId);
		expect(session?.status).toBe('running');
		expect(session?.currentRunId).toBe('run-1');
		expect(sessionsAggregate.getCurrentRun(sessionId)).toBe('run-1');
	});

	it('retains canonical envelopes for an instant route-owned transcript restore', () => {
		const sessionId = 'sess-route-restore';
		sessionsAggregate.ensureSession({
			sessionId,
			workstreamId: 'ws-route-restore',
			model: null,
		});
		const first = env(sessionId, 'run-restore', 1, {
			type: 'run.started',
			runId: 'run-restore',
			sessionId,
		});
		const second = env(sessionId, 'run-restore', 2, {
			type: 'assistant.message',
			runId: 'run-restore',
			text: 'Still visible while the chat revalidates',
		});
		sessionsAggregate.applyEventBatch([second, first, second]);

		expect(sessionsAggregate.listEnvelopesFor(sessionId)).toEqual([first, second]);
	});

	it('retains complete empty-transcript readiness across a route remount', () => {
		const sessionId = 'sess-empty-route-restore';
		sessionsAggregate.ensureSession({
			sessionId,
			workstreamId: 'ws-empty-route-restore',
			model: null,
		});

		expect(sessionsAggregate.listEnvelopesFor(sessionId)).toEqual([]);
		expect(sessionsAggregate.isTranscriptHydrated(sessionId)).toBe(false);

		sessionsAggregate.markTranscriptHydrated(sessionId);

		expect(sessionsAggregate.listEnvelopesFor(sessionId)).toEqual([]);
		expect(sessionsAggregate.isTranscriptHydrated(sessionId)).toBe(true);
	});

	it('restores a warm projection only for its exact workstream owner', () => {
		const sessionId = 'sess-owned-route-restore';
		sessionsAggregate.ensureSession({
			sessionId,
			workstreamId: 'ws-owned-route-restore',
			model: null,
		});

		expect(
			sessionsAggregate.restorableTranscriptFor(sessionId, 'ws-owned-route-restore'),
		).toBeNull();

		sessionsAggregate.markTranscriptHydrated(sessionId);

		expect(sessionsAggregate.restorableTranscriptFor(sessionId, 'ws-owned-route-restore')).toEqual(
			[],
		);
		expect(sessionsAggregate.restorableTranscriptFor(sessionId, 'ws-stale-route-owner')).toBeNull();
	});

	it('retires transcript readiness with its session and on aggregate reset', () => {
		const removedSessionId = 'sess-readiness-removed';
		const resetSessionId = 'sess-readiness-reset';
		for (const sessionId of [removedSessionId, resetSessionId]) {
			sessionsAggregate.ensureSession({
				sessionId,
				workstreamId: 'ws-readiness',
				model: null,
			});
			sessionsAggregate.markTranscriptHydrated(sessionId);
		}

		sessionsAggregate.removeSession(removedSessionId);
		expect(sessionsAggregate.isTranscriptHydrated(removedSessionId)).toBe(false);
		expect(sessionsAggregate.isTranscriptHydrated(resetSessionId)).toBe(true);

		sessionsAggregate.reset();
		expect(sessionsAggregate.isTranscriptHydrated(resetSessionId)).toBe(false);
	});

	it('running → waiting_for_approval on approval.requested', () => {
		const sessionId = 'sess-approval';
		sessionsAggregate.ensureSession({
			sessionId,
			workstreamId: 'ws-1',
			model: null,
		});
		sessionsAggregate.applyEvent(
			env(sessionId, 'run-1', 1, { type: 'run.started', runId: 'run-1', sessionId }),
		);

		sessionsAggregate.applyEvent(
			env(sessionId, 'run-1', 2, {
				type: 'approval.requested',
				runId: 'run-1',
				approvalId: 'ap-1',
				reason: 'edit manifest',
			}),
		);

		const session = sessionsAggregate.getSession(sessionId);
		expect(session?.status).toBe('waiting_for_approval');
		expect(session?.currentRunId).toBe('run-1');
	});

	it('waits for structured input and resumes only the matching active run', () => {
		const sessionId = 'sess-question';
		sessionsAggregate.ensureSession({
			sessionId,
			workstreamId: 'ws-1',
			model: null,
		});
		sessionsAggregate.applyEvent(
			env(sessionId, 'run-1', 1, { type: 'run.started', runId: 'run-1', sessionId }),
		);
		sessionsAggregate.applyEvent(
			env(sessionId, 'run-1', 2, {
				type: 'question.requested',
				runId: 'run-1',
				questionId: 'question-1',
				questions: [
					{
						id: 'question-1:0',
						prompt: 'Continue?',
						options: [{ label: 'Yes' }],
						multiSelect: false,
						allowFreeText: false,
					},
				],
			}),
		);

		expect(sessionsAggregate.getSession(sessionId)?.status).toBe('waiting_for_approval');
		sessionsAggregate.resumeRunAfterInteraction(sessionId, 'other-run');
		expect(sessionsAggregate.getSession(sessionId)?.status).toBe('waiting_for_approval');
		sessionsAggregate.resumeRunAfterInteraction(sessionId, 'run-1');
		expect(sessionsAggregate.getSession(sessionId)?.status).toBe('running');
	});

	it('does not regress a live run when a delayed idle summary hydrates session ownership', () => {
		const sessionId = 'sess-live-before-summary';
		sessionsAggregate.applyEvent(
			env(sessionId, 'run-live', 1, {
				type: 'run.started',
				runId: 'run-live',
				sessionId,
			}),
		);

		sessionsAggregate.hydrateSession({
			sessionId,
			workstreamId: 'ws-live',
			displayName: 'Live edit',
			model: 'claude-sonnet-4-6',
			status: 'idle',
			startedAt: '2026-07-18T01:00:00.000Z',
		});

		expect(sessionsAggregate.getSession(sessionId)).toMatchObject({
			workstreamId: 'ws-live',
			displayName: 'Live edit',
			status: 'running',
			currentRunId: 'run-live',
		});
	});

	it('preserves live approval and terminal folds over stale session summaries', () => {
		const approvalSessionId = 'sess-approval-before-summary';
		sessionsAggregate.applyEventBatch([
			env(approvalSessionId, 'run-approval', 1, {
				type: 'run.started',
				runId: 'run-approval',
				sessionId: approvalSessionId,
			}),
			env(approvalSessionId, 'run-approval', 2, {
				type: 'approval.requested',
				runId: 'run-approval',
				approvalId: 'approval-live',
				reason: 'Allow tests?',
			}),
		]);
		sessionsAggregate.hydrateSession({
			sessionId: approvalSessionId,
			workstreamId: 'ws-approval',
			model: null,
			status: 'running',
			startedAt: '2026-07-18T01:00:00.000Z',
		});
		expect(sessionsAggregate.getSession(approvalSessionId)?.status).toBe('waiting_for_approval');

		const completedSessionId = 'sess-complete-before-summary';
		sessionsAggregate.applyEventBatch([
			env(completedSessionId, 'run-complete', 1, {
				type: 'run.started',
				runId: 'run-complete',
				sessionId: completedSessionId,
			}),
			env(completedSessionId, 'run-complete', 2, {
				type: 'run.completed',
				runId: 'run-complete',
				summary: 'Ready',
			}),
		]);
		sessionsAggregate.hydrateSession({
			sessionId: completedSessionId,
			workstreamId: 'ws-complete',
			model: null,
			status: 'running',
			startedAt: '2026-07-18T01:00:00.000Z',
		});
		expect(sessionsAggregate.getSession(completedSessionId)).toMatchObject({
			status: 'completed',
			currentRunId: null,
		});
	});

	it('running → completed on run.completed clears currentRunId', () => {
		const sessionId = 'sess-completed';
		sessionsAggregate.ensureSession({
			sessionId,
			workstreamId: 'ws-1',
			model: null,
		});
		sessionsAggregate.applyEvent(
			env(sessionId, 'run-1', 1, { type: 'run.started', runId: 'run-1', sessionId }),
		);

		sessionsAggregate.applyEvent(
			env(sessionId, 'run-1', 2, { type: 'run.completed', runId: 'run-1', summary: 'ok' }),
		);

		const session = sessionsAggregate.getSession(sessionId);
		expect(session?.status).toBe('completed');
		expect(session?.currentRunId).toBeNull();
		expect(sessionsAggregate.getCurrentRun(sessionId)).toBeNull();
	});

	it('running → idle, not failed, with lastError "cancelled" when the user stopped the run', () => {
		const sessionId = 'sess-failed';
		sessionsAggregate.ensureSession({
			sessionId,
			workstreamId: 'ws-1',
			model: null,
		});
		sessionsAggregate.applyEvent(
			env(sessionId, 'run-1', 1, { type: 'run.started', runId: 'run-1', sessionId }),
		);

		sessionsAggregate.applyEvent(
			env(sessionId, 'run-1', 2, {
				type: 'run.failed',
				runId: 'run-1',
				error: 'cancelled by user',
			}),
		);

		const session = sessionsAggregate.getSession(sessionId);
		expect(session?.status).toBe('idle');
		expect(session?.currentRunId).toBeNull();
		expect(session?.lastError).toBe('cancelled');
	});

	it('startSession → assistant.message → run.completed builds 3 events in eventsBySession', () => {
		const sessionId = 'sess-transcript';
		sessionsAggregate.ensureSession({
			sessionId,
			workstreamId: 'ws-1',
			model: 'claude-sonnet-4-6',
		});

		sessionsAggregate.applyEventBatch([
			env(sessionId, 'run-1', 1, { type: 'run.started', runId: 'run-1', sessionId }),
			env(sessionId, 'run-1', 2, { type: 'assistant.message', runId: 'run-1', text: 'hi' }),
			env(sessionId, 'run-1', 3, { type: 'run.completed', runId: 'run-1', summary: 'done' }),
		]);

		const events = sessionsAggregate.listEventsFor(sessionId);
		expect(events).toHaveLength(3);
		expect(events[0]?.type).toBe('run.started');
		expect(events[1]?.type).toBe('assistant.message');
		expect(events[2]?.type).toBe('run.completed');
		expect(sessionsAggregate.getSession(sessionId)?.status).toBe('completed');
	});

	it('atomically appends a long replay while preserving the final lifecycle state', () => {
		const sessionId = 'sess-long-replay';
		const events: EventEnvelope[] = [
			env(sessionId, 'run-1', 1, { type: 'run.started', runId: 'run-1', sessionId }),
			...Array.from({ length: 4_998 }, (_, index) =>
				env(sessionId, 'run-1', index + 2, {
					type: 'assistant.message' as const,
					runId: 'run-1',
					text: `chunk-${index}`,
				}),
			),
			env(sessionId, 'run-1', 5_000, {
				type: 'run.completed',
				runId: 'run-1',
				summary: 'done',
			}),
		];

		expect(sessionsAggregate.applyEventBatch(events)).toBe(5_000);
		expect(sessionsAggregate.listEventsFor(sessionId)).toHaveLength(5_000);
		expect(sessionsAggregate.getSession(sessionId)).toMatchObject({
			status: 'completed',
			currentRunId: null,
		});
	});

	it('keeps 5k one-by-one live appends on the monotonic ingestion path', () => {
		const sessionId = 'sess-long-live';
		sessionsAggregate.ensureSession({
			sessionId,
			workstreamId: 'ws-1',
			model: null,
		});

		for (let seq = 1; seq <= 5_000; seq += 1) {
			sessionsAggregate.applyEvent(
				env(sessionId, 'run-1', seq, {
					type: 'assistant.message',
					runId: 'run-1',
					text: `live-${seq}`,
				}),
			);
		}

		expect(sessionsAggregate.listEventsFor(sessionId)).toHaveLength(5_000);
		expect(sessionsAggregate.eventIngestionStats(sessionId)).toEqual({
			monotonicAccepts: 5_000,
			canonicalRebuilds: 0,
		});
	});

	it('refolds late lower-seq history canonically instead of preserving arrival order', () => {
		const sessionId = 'sess-late-canonical';
		sessionsAggregate.ensureSession({
			sessionId,
			workstreamId: 'ws-1',
			model: null,
		});

		sessionsAggregate.applyEvent(
			env(sessionId, 'run-1', 47, {
				type: 'run.failed',
				runId: 'run-1',
				error: 'later terminal by provider order',
			}),
		);
		expect(sessionsAggregate.getSession(sessionId)?.status).toBe('failed');

		sessionsAggregate.applyEventBatch([
			env(sessionId, 'run-1', 42, {
				type: 'run.started',
				runId: 'run-1',
				sessionId,
			}),
			env(sessionId, 'run-1', 44, {
				type: 'run.completed',
				runId: 'run-1',
				summary: 'canonical completion',
			}),
		]);

		expect(sessionsAggregate.listEventsFor(sessionId).map((event) => event.type)).toEqual([
			'run.started',
			'run.completed',
			'run.failed',
		]);
		expect(sessionsAggregate.getSession(sessionId)).toMatchObject({
			status: 'completed',
			currentRunId: null,
			lastError: null,
		});
		expect(sessionsAggregate.eventIngestionStats(sessionId).canonicalRebuilds).toBe(1);
	});

	it('resurrection guard: ignores a late run.started for a runId that already saw a terminal', () => {
		const sessionId = 'sess-resurrect';
		sessionsAggregate.ensureSession({
			sessionId,
			workstreamId: 'ws-1',
			model: null,
		});
		sessionsAggregate.applyEvent(
			env(sessionId, 'run-1', 1, { type: 'run.started', runId: 'run-1', sessionId }),
		);
		sessionsAggregate.applyEvent(
			env(sessionId, 'run-1', 2, { type: 'run.completed', runId: 'run-1', summary: 'done' }),
		);

		sessionsAggregate.applyEvent(
			env(sessionId, 'run-1', 3, { type: 'run.started', runId: 'run-1', sessionId }),
		);

		const session = sessionsAggregate.getSession(sessionId);
		expect(session?.status).toBe('completed');
		expect(session?.currentRunId).toBeNull();
		expect(sessionsAggregate.getCurrentRun(sessionId)).toBeNull();
	});

	it('first-terminal-wins: a late second terminal for the same runId does not flip session status', () => {
		const sessionId = 'sess-first-terminal';
		sessionsAggregate.ensureSession({
			sessionId,
			workstreamId: 'ws-1',
			model: null,
		});
		sessionsAggregate.applyEvent(
			env(sessionId, 'run-1', 1, { type: 'run.started', runId: 'run-1', sessionId }),
		);
		sessionsAggregate.applyEvent(
			env(sessionId, 'run-1', 2, { type: 'run.completed', runId: 'run-1', summary: 'done' }),
		);

		sessionsAggregate.applyEvent(
			env(sessionId, 'run-1', 3, { type: 'run.failed', runId: 'run-1', error: 'cancelled' }),
		);

		const session = sessionsAggregate.getSession(sessionId);
		expect(session?.status).toBe('completed');
		expect(session?.lastError).toBeNull();
		expect(session?.currentRunId).toBeNull();
	});

	it('first-terminal-wins: a new run for the SAME session after a terminal is unaffected (different runId)', () => {
		const sessionId = 'sess-next-run';
		sessionsAggregate.ensureSession({
			sessionId,
			workstreamId: 'ws-1',
			model: null,
		});
		sessionsAggregate.applyEvent(
			env(sessionId, 'run-1', 1, { type: 'run.started', runId: 'run-1', sessionId }),
		);
		sessionsAggregate.applyEvent(
			env(sessionId, 'run-1', 2, { type: 'run.completed', runId: 'run-1', summary: 'done' }),
		);

		sessionsAggregate.applyEvent(
			env(sessionId, 'run-2', 3, { type: 'run.started', runId: 'run-2', sessionId }),
		);

		const session = sessionsAggregate.getSession(sessionId);
		expect(session?.status).toBe('running');
		expect(session?.currentRunId).toBe('run-2');
	});

	it('unknown and tool events append without changing session status', () => {
		const sessionId = 'sess-tool';
		sessionsAggregate.ensureSession({
			sessionId,
			workstreamId: 'ws-1',
			model: null,
		});
		sessionsAggregate.applyEvent(
			env(sessionId, 'run-1', 1, { type: 'run.started', runId: 'run-1', sessionId }),
		);

		sessionsAggregate.applyEvent(
			env(sessionId, 'run-1', 2, { type: 'tool.started', runId: 'run-1', name: 'Bash' }),
		);
		sessionsAggregate.applyEvent(
			env(sessionId, 'run-1', 3, { type: 'tool.completed', runId: 'run-1', name: 'Bash' }),
		);
		sessionsAggregate.applyEvent(
			env(sessionId, 'run-1', 4, { type: 'unknown', raw: { type: 'thinking.delta' } }),
		);

		const events = sessionsAggregate.listEventsFor(sessionId);
		expect(events).toHaveLength(4);
		expect(sessionsAggregate.getSession(sessionId)?.status).toBe('running');
	});

	it('does not let a late approval resurrect a terminal run', () => {
		const sessionId = 'sess-late-approval';
		sessionsAggregate.ensureSession({
			sessionId,
			workstreamId: 'ws-1',
			model: null,
		});

		sessionsAggregate.applyEvent(
			env(sessionId, 'run-1', 1, { type: 'run.started', runId: 'run-1', sessionId }),
		);
		sessionsAggregate.applyEvent(
			env(sessionId, 'run-1', 2, { type: 'run.completed', runId: 'run-1', summary: 'done' }),
		);
		sessionsAggregate.applyEvent(
			env(sessionId, 'run-1', 3, {
				type: 'approval.requested',
				runId: 'run-1',
				approvalId: 'approval-late',
				reason: 'late approval',
			}),
		);

		expect(sessionsAggregate.getSession(sessionId)?.status).toBe('completed');
		expect(sessionsAggregate.getCurrentRun(sessionId)).toBeNull();
	});

	it('upgrades placeholder session ownership once the real workstream is known', () => {
		const sessionId = 'sess-upgrade';
		sessionsAggregate.applyEvent(
			env(sessionId, 'run-before-summary', 1, {
				type: 'run.started',
				runId: 'run-before-summary',
				sessionId,
			}),
		);
		expect(sessionsAggregate.getSession(sessionId)).toMatchObject({
			workstreamId: '_unknown',
			status: 'running',
			currentRunId: 'run-before-summary',
		});

		const upgraded = sessionsAggregate.hydrateSession({
			sessionId,
			workstreamId: 'ws-real',
			displayName: 'Hydrated chat',
			model: 'claude-haiku-4-5',
			status: 'idle',
			startedAt: '2026-07-18T08:00:00.000Z',
		});

		expect(upgraded).toMatchObject({
			workstreamId: 'ws-real',
			displayName: 'Hydrated chat',
			model: 'claude-haiku-4-5',
			status: 'running',
			currentRunId: 'run-before-summary',
		});
		expect(sessionsAggregate.getSession(sessionId)).toEqual(upgraded);
	});

	it('keeps an existing known workstream owner on a later mismatched ensure', () => {
		const sessionId = 'sess-mismatch';
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		sessionsAggregate.ensureSession({
			sessionId,
			workstreamId: 'ws-a',
			model: null,
		});

		const existing = sessionsAggregate.ensureSession({
			sessionId,
			workstreamId: 'ws-b',
			model: 'claude-haiku-4-5',
		});

		expect(existing.workstreamId).toBe('ws-a');
		expect(sessionsAggregate.getSession(sessionId)?.workstreamId).toBe('ws-a');
		expect(warn).toHaveBeenCalledOnce();
		warn.mockRestore();
	});

	it('removes archived sessions without disturbing sibling workstreams', () => {
		for (const [sessionId, workstreamId] of [
			['session-visible', 'workstream-a'],
			['session-archived', 'workstream-a'],
			['session-other', 'workstream-b'],
		] as const) {
			sessionsAggregate.ensureSession({
				sessionId,
				workstreamId,
				model: null,
			});
		}
		sessionsAggregate.applyEvent(
			env('session-archived', 'run-1', 1, {
				type: 'run.started',
				runId: 'run-1',
				sessionId: 'session-archived',
			}),
		);

		sessionsAggregate.reconcileWorkstreamSessions(
			'workstream-a',
			new Set<SessionId>(['session-visible']),
		);

		expect(sessionsAggregate.getSession('session-visible')).not.toBeNull();
		expect(sessionsAggregate.getSession('session-archived')).toBeNull();
		expect(sessionsAggregate.listEventsFor('session-archived')).toEqual([]);
		expect(sessionsAggregate.getCurrentRun('session-archived')).toBeNull();
		expect(sessionsAggregate.getSession('session-other')).not.toBeNull();
	});
});
