import { describe, expect, it } from 'vitest';
import {
	foldSessionStatus,
	foldSessionStatusIncremental,
	isCancellationError,
	isLifecycleKind,
	LIFECYCLE_KINDS,
	nextSessionStatus,
	runEnding,
	type LifecycleEnvelope,
	type SessionStatus,
} from './agent-state-machine';

function envelope(type: string, runId = 'run-1', error?: string): LifecycleEnvelope {
	return error === undefined ? { runId, event: { type } } : { runId, event: { type, error } };
}

describe('agent state machine', () => {
	it('names every lifecycle kind once', () => {
		expect(LIFECYCLE_KINDS).toEqual([
			'run.started',
			'approval.requested',
			'question.requested',
			'approval.decided',
			'question.answered',
			'turn.ended',
			'turn.resumed',
			'run.completed',
			'run.failed',
			'checkpoint.restored',
		]);
		for (const kind of LIFECYCLE_KINDS) expect(isLifecycleKind(kind)).toBe(true);
		expect(isLifecycleKind('assistant.message')).toBe(false);
	});

	it('moves to where each lifecycle event leads', () => {
		expect(nextSessionStatus('idle', 'run.started')).toBe('running');
		expect(nextSessionStatus('running', 'approval.requested')).toBe('waiting_for_approval');
		expect(nextSessionStatus('running', 'question.requested')).toBe('waiting_for_approval');
		expect(nextSessionStatus('running', 'run.completed')).toBe('completed');
		expect(nextSessionStatus('running', 'run.failed')).toBe('failed');
		expect(nextSessionStatus('waiting_for_approval', 'run.completed')).toBe('completed');
		expect(nextSessionStatus('waiting_for_approval', 'run.failed')).toBe('failed');
		expect(nextSessionStatus('completed', 'run.started')).toBe('running');
		expect(nextSessionStatus('failed', 'run.started')).toBe('running');
		expect(nextSessionStatus('running', 'run.started')).toBe('running');
		expect(nextSessionStatus('running', 'approval.decided')).toBe('running');
		expect(nextSessionStatus('idle', 'question.answered')).toBe('idle');
		expect(
			nextSessionStatus('waiting_for_approval', 'approval.decided', { stillWaiting: true }),
		).toBe('waiting_for_approval');
		expect(nextSessionStatus('completed', 'run.completed')).toBe('completed');
		expect(nextSessionStatus('failed', 'run.failed')).toBe('failed');
		expect(nextSessionStatus('idle', 'run.completed')).toBe('completed');
		expect(nextSessionStatus('idle', 'run.failed')).toBe('failed');
		expect(nextSessionStatus('running', 'turn.ended')).toBe('completed');
		expect(nextSessionStatus('completed', 'turn.resumed')).toBe('running');
		expect(nextSessionStatus('running', 'turn.resumed')).toBe('running');
		expect(nextSessionStatus('failed', 'turn.resumed')).toBe('failed');
		expect(nextSessionStatus('idle', 'turn.resumed')).toBe('idle');
		for (const status of [
			'idle',
			'running',
			'waiting_for_approval',
			'completed',
			'failed',
		] satisfies SessionStatus[]) {
			expect(nextSessionStatus(status, 'checkpoint.restored')).toBe('idle');
		}
	});

	it('reads a turn that ends over its commands as done while its run stays open, until the agent goes on', () => {
		const ended = foldSessionStatus('idle', [envelope('run.started'), envelope('turn.ended')]);
		expect(ended).toMatchObject({ status: 'completed', currentRunId: 'run-1', lastError: null });

		const resumed = foldSessionStatusIncremental(ended, [envelope('turn.resumed')]);
		expect(resumed).toMatchObject({ status: 'running', currentRunId: 'run-1' });

		const closed = foldSessionStatusIncremental(resumed ?? ended, [
			envelope('turn.ended'),
			envelope('run.completed'),
			envelope('turn.resumed'),
		]);
		expect(closed).toMatchObject({ status: 'completed', currentRunId: null });
	});

	it('folds a started, approved, completed session from idle', () => {
		const folded = foldSessionStatus('idle', [
			envelope('run.started'),
			envelope('approval.requested'),
			envelope('run.completed'),
		]);
		expect(folded.status).toBe('completed');
		expect(folded.currentRunId).toBeNull();
		expect(folded.lastError).toBeNull();
		expect(folded.terminatedRunIds).toEqual(new Set(['run-1']));
	});

	it('keeps a run open through an approval request', () => {
		const folded = foldSessionStatus('idle', [
			envelope('run.started'),
			envelope('approval.requested'),
		]);
		expect(folded.status).toBe('waiting_for_approval');
		expect(folded.currentRunId).toBe('run-1');
	});

	it('records a failure, and lands a run the user stopped in a neutral idle state', () => {
		expect(
			foldSessionStatus('idle', [envelope('run.started'), envelope('run.failed', 'run-1', 'boom')]),
		).toMatchObject({ status: 'failed', lastError: 'boom' });
		for (const cancelled of ['cancelled', 'CANCELLED', 'Run cancelled by user', 'canceled']) {
			expect(
				foldSessionStatus('idle', [
					envelope('run.started'),
					envelope('run.failed', 'run-1', cancelled),
				]),
			).toMatchObject({ status: 'idle', currentRunId: null, lastError: 'cancelled' });
		}
		const running = foldSessionStatus('idle', [envelope('run.started')]);
		expect(
			foldSessionStatusIncremental(running, [envelope('run.failed', 'run-1', 'cancelled')]),
		).toMatchObject({ status: 'idle', lastError: 'cancelled' });
		expect(nextSessionStatus('running', 'run.failed', { error: 'cancelled' })).toBe('idle');
		expect(nextSessionStatus('waiting_for_approval', 'run.failed', { error: 'cancelled' })).toBe(
			'idle',
		);
		expect(nextSessionStatus('running', 'run.failed', { error: 'boom' })).toBe('failed');
	});

	it('counts only a stop as a cancellation, never a failure that mentions cancelling', () => {
		expect(isCancellationError('cancelled')).toBe(true);
		expect(isCancellationError('CANCELLED')).toBe(true);
		expect(isCancellationError('cut off')).toBe(false);
		expect(isCancellationError('CANCEL_FAILED: provider cancellation did not finish')).toBe(false);
		expect(
			foldSessionStatus('idle', [
				envelope('run.started'),
				envelope('run.failed', 'run-1', 'CANCEL_FAILED: provider cancellation did not finish'),
			]),
		).toMatchObject({ status: 'failed' });
	});

	it('ignores a late event for a run that already terminated', () => {
		const folded = foldSessionStatus('idle', [
			envelope('run.started'),
			envelope('run.completed'),
			envelope('run.started'),
			envelope('run.failed', 'run-1', 'late'),
		]);
		expect(folded.status).toBe('completed');
	});

	it('returns a chat to idle on checkpoint.restored, even mid-run', () => {
		const folded = foldSessionStatus('idle', [
			envelope('run.started'),
			envelope('checkpoint.restored'),
		]);
		expect(folded).toMatchObject({ status: 'idle', currentRunId: null, lastError: null });
	});

	it('folds incrementally and reports when nothing changed', () => {
		const base = foldSessionStatus('idle', [envelope('run.started')]);
		expect(foldSessionStatusIncremental(base, [envelope('assistant.message')])).toBeNull();
		const next = foldSessionStatusIncremental(base, [envelope('run.completed')]);
		expect(next).toMatchObject({ status: 'completed', currentRunId: null });
		expect(next?.terminatedRunIds).toEqual(new Set(['run-1']));
		expect(base.terminatedRunIds).toEqual(new Set(['run-1']));
		expect(foldSessionStatusIncremental(base, [envelope('run.started')])).toBeNull();
	});
});

describe('one session machine', () => {
	const statuses = [
		'idle',
		'running',
		'waiting_for_approval',
		'completed',
		'failed',
	] satisfies SessionStatus[];

	function request(type: string, id: string, runId = 'run-1'): LifecycleEnvelope {
		return {
			runId,
			event: type.startsWith('approval.') ? { type, approvalId: id } : { type, questionId: id },
		};
	}

	it('moves the fold exactly as nextSessionStatus says, from every status on every kind', () => {
		for (const status of statuses) {
			for (const kind of LIFECYCLE_KINDS) {
				const folded = foldSessionStatusIncremental(
					{
						status,
						currentRunId: 'run-1',
						lastError: null,
						terminatedRunIds: new Set(),
						openRequests: new Set(),
					},
					[envelope(kind)],
				);
				expect([status, kind, folded?.status ?? status]).toEqual([
					status,
					kind,
					nextSessionStatus(status, kind),
				]);
			}
		}
	});

	it('goes back to running once the user answers the last request a run waits on', () => {
		const asked = [
			envelope('run.started'),
			request('approval.requested', 'approval-1'),
			request('question.requested', 'question-1'),
		];
		const allowed = [...asked, request('approval.decided', 'approval-1')];
		expect(foldSessionStatus('idle', allowed)).toMatchObject({
			status: 'waiting_for_approval',
			currentRunId: 'run-1',
		});
		expect(
			foldSessionStatus('idle', [...allowed, request('question.answered', 'question-1')]),
		).toMatchObject({ status: 'running', currentRunId: 'run-1' });
	});

	it('ends a run that Malini, the bridge or a reset cut as quietly as a stop', () => {
		for (const error of [
			'interrupted: app closed mid-run',
			'interrupted: agent bridge restarted',
			'paused: malini closed mid-run',
			'reset by user',
		]) {
			expect(
				foldSessionStatus('idle', [envelope('run.started'), envelope('run.failed', 'run-1', error)])
					.status,
			).toBe('idle');
			expect(nextSessionStatus('running', 'run.failed', { error })).toBe('idle');
		}
	});

	it('names how a run ended once, for the session, the turn and the transcript', () => {
		expect(runEnding(null)).toBe('succeeded');
		expect(runEnding('model overloaded')).toBe('failed');
		expect(runEnding('cancelled')).toBe('cancelled');
		expect(runEnding("You've hit your session limit", true)).toBe('interrupted');
		for (const error of [
			'interrupted: app closed mid-run',
			'interrupted: agent bridge restarted',
			'paused: malini closed mid-run',
			'reset by user',
		]) {
			expect(runEnding(error)).toBe('interrupted');
		}
	});
});
