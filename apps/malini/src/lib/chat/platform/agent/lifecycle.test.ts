import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listEventRowsForSession } from '../events.repository';
import { getInteraction, recordPendingInteraction } from '../interactions.repository';
import { get, run, scalar } from '$main/db/rows';
import { getRun } from '../runs.repository';
import { getSession } from '../sessions.repository';
import {
	BRIDGE_INTERRUPTED_ERROR,
	camelEnvelopeJson,
	AgentRunLeases,
	emitPersisted,
	hasActiveRun,
	LifecycleError,
	listActiveRunIdsForSession,
	ORPHAN_INTERRUPTED_ERROR,
	reapOrphansOnExit,
	reapOrphansOnStartup,
	resetWorkstreamRuns,
	terminalizeRunsAfterBridgeLoss,
	type SyntheticEventEnvelope,
} from './lifecycle';
import {
	createTestContext,
	seedOpenRun,
	seedSession,
	seedWorkstream,
	type TestContext,
} from './test-support';

let test: TestContext;
let leases: AgentRunLeases;

beforeEach(() => {
	leases = new AgentRunLeases();
	test = createTestContext();
});

afterEach(() => {
	test.cleanup();
});

function seedRunning(runId = 'run-1', sessionId = 'sess-1', workstreamId = 'ws-1'): void {
	seedWorkstream(test.db, test.appDataRoot, workstreamId);
	seedSession(test.db, sessionId, workstreamId, 'running');
	seedOpenRun(test.db, runId, sessionId);
}

describe('envelopes', () => {
	it('persists then emits with the seq the row got, in pump shape', () => {
		seedRunning();
		const emitted: Array<[SyntheticEventEnvelope, number]> = [];
		const envelope: SyntheticEventEnvelope = {
			sessionId: 'sess-1',
			runId: 'run-1',
			seq: 0,
			eventKind: 'run.failed',
			eventPayload: { error: 'x' },
		};
		const seq = emitPersisted(test.db, envelope, (env, s) => emitted.push([env, s]));
		expect(emitted).toEqual([[{ ...envelope, seq }, seq]]);
		expect(listEventRowsForSession(test.db, 'sess-1', 0)).toEqual([
			{ seq, runId: 'run-1', kind: 'run.failed', payload: { error: 'x' } },
		]);
		expect(camelEnvelopeJson(envelope, seq)).toEqual({
			sessionId: 'sess-1',
			runId: 'run-1',
			seq,
			event: { type: 'run.failed', error: 'x', runId: 'run-1' },
		});
		expect(
			camelEnvelopeJson(
				{ ...envelope, eventKind: 'user.message', eventPayload: { text: 'hi' } },
				9,
			),
		).toEqual({
			sessionId: 'sess-1',
			runId: 'run-1',
			seq: 9,
			event: { type: 'user.message', text: 'hi', runId: 'run-1' },
		});
	});
});

describe('leases', () => {
	it('rejects a run while the workstream has an open row, and while another send holds it', () => {
		seedRunning();
		expect(() => leases.acquireRun(test.db, 'ws-1')).toThrow(
			'work stream `ws-1` already has an active run',
		);
		seedWorkstream(test.db, test.appDataRoot, 'ws-2');
		const lease = leases.acquireRun(test.db, 'ws-2');
		expect(leases.runningCount()).toBe(1);
		expect(() => leases.acquireRun(test.db, 'ws-2')).toThrow(LifecycleError);
		expect(() => leases.acquireRunChangeCapture('ws-2')).toThrow('already has an active run');
		expect(() => leases.acquireWorkstreamTeardown(test.db, 'ws-2')).toThrow(
			'work stream `ws-2` has active agent runs; stop them before archiving or deleting: ws-2',
		);
		lease.release();
		lease.release();
		expect(leases.runningCount()).toBe(0);
		const capture = leases.acquireRunChangeCapture('ws-2');
		expect(() => leases.acquireRun(test.db, 'ws-2')).toThrow('already has an active run');
		capture.release();
		expect(leases.acquireRun(test.db, 'ws-2').workstreamId).toBe('ws-2');
	});

	it('refuses teardown of a workstream with a persisted open run without leaking its fence', () => {
		seedRunning();
		expect(() => leases.acquireWorkstreamTeardown(test.db, 'ws-1')).toThrow(
			'work stream `ws-1` has active agent runs; stop them before archiving or deleting: run-1',
		);
		run(test.db, 'UPDATE agent_runs SET completed_at = ? WHERE id = ?', 'now', 'run-1');
		const teardown = leases.acquireWorkstreamTeardown(test.db, 'ws-1');
		expect(() => leases.acquireRun(test.db, 'ws-1')).toThrow(
			'work stream `ws-1` is being archived or deleted',
		);
		expect(() => leases.acquireWorkstreamTeardown(test.db, 'ws-1')).toThrow(
			'is being archived or deleted',
		);
		teardown.release();
		expect(hasActiveRun(test.db, 'ws-1')).toBe(false);
	});
});

describe('recovery', () => {
	it('reaps orphans at startup: persisted run.failed, closed run, idle session, closed interactions, attachments released', () => {
		seedRunning();
		recordPendingInteraction(test.db, {
			kind: 'question',
			sessionId: 'sess-1',
			runId: 'run-1',
			requestId: 'q-1',
			requestPayload: { questions: [] },
			requestedAt: '2026-01-01T00:00:00Z',
		});
		run(
			test.db,
			`INSERT INTO agent_attachments (id, workstream_id, run_id, display_name, relative_path, media_type, size, sha256, state, created_at, expires_at, bound_at)
			 VALUES ('att-00000000000000000000000000000001', 'ws-1', 'run-1', 'a.txt', '.malini/agent-attachments/a.txt', 'text/plain', 1, 'x', 'bound', 't', NULL, 't')`,
		);
		expect(reapOrphansOnStartup(test.db)).toBe(1);
		expect(reapOrphansOnStartup(test.db)).toBe(0);
		expect(getRun(test.db, 'run-1')).toMatchObject({ error: ORPHAN_INTERRUPTED_ERROR });
		expect(getRun(test.db, 'run-1')?.completedAt).not.toBeNull();
		expect(getSession(test.db, 'sess-1')?.status).toBe('idle');
		expect(getInteraction(test.db, 'question', 'sess-1', 'run-1', 'q-1')?.state).toBe('closed');
		expect(listEventRowsForSession(test.db, 'sess-1', 0)).toEqual([
			{ seq: 1, runId: 'run-1', kind: 'run.failed', payload: { error: ORPHAN_INTERRUPTED_ERROR } },
		]);
		expect(get<{ state: string }>(test.db, 'SELECT state FROM agent_attachments')).toEqual({
			state: 'staged',
		});
		expect(listActiveRunIdsForSession(test.db, 'sess-1')).toEqual([]);
	});

	it('terminalizes runs after bridge loss atomically and emits only after commit', () => {
		seedRunning('run-a', 'sess-a', 'ws-a');
		seedRunning('run-b', 'sess-b', 'ws-b');
		const emitted: number[] = [];
		expect(terminalizeRunsAfterBridgeLoss(test.db, (_envelope, seq) => emitted.push(seq))).toBe(2);
		expect(emitted).toHaveLength(2);
		expect(getRun(test.db, 'run-a')).toMatchObject({ error: BRIDGE_INTERRUPTED_ERROR });
		expect(getSession(test.db, 'sess-b')?.status).toBe('idle');
		expect(terminalizeRunsAfterBridgeLoss(test.db, () => {})).toBe(0);
		expect(scalar(test.db, 'SELECT COUNT(*) FROM agent_events')).toBe(2);
	});

	it('resets a workstream: run.failed per open run, marker summary, idle sessions, count', () => {
		seedRunning('run-a', 'sess-a', 'ws-1');
		seedSession(test.db, 'sess-b', 'ws-1', 'running');
		seedOpenRun(test.db, 'run-b', 'sess-b');
		seedRunning('run-other', 'sess-other', 'ws-other');
		const emitted: SyntheticEventEnvelope[] = [];
		expect(resetWorkstreamRuns(test.db, 'ws-1', (envelope) => emitted.push(envelope))).toBe(2);
		expect(emitted.map((envelope) => envelope.eventPayload)).toEqual([
			{ error: 'reset by user' },
			{ error: 'reset by user' },
		]);
		expect(getRun(test.db, 'run-a')).toMatchObject({
			summary: 'reset-by-user',
			error: 'reset by user',
		});
		expect(getSession(test.db, 'sess-b')?.status).toBe('idle');
		expect(getRun(test.db, 'run-other')?.completedAt).toBeNull();
		expect(resetWorkstreamRuns(test.db, 'ws-1', () => {})).toBe(0);
	});

	it('reaps orphans on exit with a live envelope each and names the runs it closed', () => {
		seedRunning();
		const seqs: number[] = [];
		expect(reapOrphansOnExit(test.db, (_envelope, seq) => seqs.push(seq))).toEqual(['run-1']);
		expect(seqs).toEqual([1]);
		expect(getRun(test.db, 'run-1')).toMatchObject({ error: ORPHAN_INTERRUPTED_ERROR });
		expect(reapOrphansOnExit(test.db, () => {})).toEqual([]);
	});
});
