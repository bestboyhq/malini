import { describe, expect, it } from 'vitest';
import {
	foldSessionStatus,
	foldSessionStatusIncremental,
	isCancellationError,
	isLifecycleKind,
	LIFECYCLE_KINDS,
	nextSessionStatus,
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
			'run.completed',
			'run.failed',
			'checkpoint.restored',
		]);
		for (const kind of LIFECYCLE_KINDS) expect(isLifecycleKind(kind)).toBe(true);
		expect(isLifecycleKind('assistant.message')).toBe(false);
	});

	it('transitions only where the table says a move is possible', () => {
		expect(nextSessionStatus('idle', 'run.started')).toBe('running');
		expect(nextSessionStatus('running', 'approval.requested')).toBe('waiting_for_approval');
		expect(nextSessionStatus('running', 'question.requested')).toBe('waiting_for_approval');
		expect(nextSessionStatus('running', 'run.completed')).toBe('completed');
		expect(nextSessionStatus('running', 'run.failed')).toBe('failed');
		expect(nextSessionStatus('waiting_for_approval', 'run.completed')).toBe('completed');
		expect(nextSessionStatus('waiting_for_approval', 'run.failed')).toBe('failed');
		expect(nextSessionStatus('completed', 'run.started')).toBe('running');
		expect(nextSessionStatus('failed', 'run.started')).toBe('running');
		expect(nextSessionStatus('running', 'run.started')).toBe('invalid');
		expect(nextSessionStatus('completed', 'run.completed')).toBe('completed');
		expect(nextSessionStatus('failed', 'run.failed')).toBe('failed');
		expect(nextSessionStatus('idle', 'run.completed')).toBe('completed');
		expect(nextSessionStatus('idle', 'run.failed')).toBe('failed');
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
		expect(nextSessionStatus('running', 'run.failed', 'cancelled')).toBe('idle');
		expect(nextSessionStatus('waiting_for_approval', 'run.failed', 'cancelled')).toBe('idle');
		expect(nextSessionStatus('running', 'run.failed', 'boom')).toBe('failed');
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
