import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendEvent, listEventRowsForSession } from '../events.repository';
import { getInteraction, recordPendingInteraction } from '../interactions.repository';
import { get, run, scalar } from '$main/db/rows';
import { getRun, recordOpenTurnReply } from '../runs.repository';
import { getSession } from '../sessions.repository';
import { BRIDGE_INTERRUPTED_ERROR, ORPHAN_INTERRUPTED_ERROR } from '$contract/agent-state-machine';
import {
	camelEnvelopeJson,
	AgentRunLeases,
	emitPersisted,
	hasActiveRun,
	LifecycleError,
	listActiveRunIdsForSession,
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

const NOW = '2026-10-28T09:00:00.000Z';

let test: TestContext;
let leases: AgentRunLeases;

beforeEach(() => {
	leases = new AgentRunLeases();
	test = createTestContext();
});

afterEach(() => {
	vi.useRealTimers();
	test.cleanup();
});

function seedRunning(runId = 'run-1', sessionId = 'sess-1', workstreamId = 'ws-1'): void {
	seedWorkstream(test.db, test.appDataRoot, workstreamId);
	seedSession(test.db, sessionId, workstreamId, 'running');
	seedOpenRun(test.db, runId, sessionId);
}

describe('envelopes', () => {
	it('persists then emits with the seq the row got, in pump shape, stamped with when Malini made it', () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(NOW);
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
			emittedAt: NOW,
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
			emittedAt: NOW,
		});
	});
});

describe('leases', () => {
	it('rejects a run while its own chat runs or sends, and lets a sibling chat run beside it', () => {
		seedRunning();
		expect(() => leases.acquireRun(test.db, 'ws-1', 'sess-1')).toThrow(
			'`sess-1` already has an active run',
		);
		seedSession(test.db, 'sess-2', 'ws-1', 'idle');
		const sibling = leases.acquireRun(test.db, 'ws-1', 'sess-2');
		expect(() => leases.acquireRun(test.db, 'ws-1', 'sess-2')).toThrow(LifecycleError);
		expect(() => leases.acquireRunChangeRecovery('ws-1')).toThrow('already has an active run');
		expect(() => leases.acquireWorkstreamTeardown(test.db, 'ws-1')).toThrow(
			'work stream `ws-1` has active agent runs; stop them before archiving or deleting: ws-1',
		);
		const capture = leases.acquireRunChangeCapture('ws-1');
		sibling.release();
		sibling.release();
		const overlapping = leases.acquireRunChangeCapture('ws-1');
		capture.release();
		expect(() => leases.acquireRun(test.db, 'ws-1', 'sess-2')).toThrow(
			'`ws-1` already has an active run',
		);
		overlapping.release();
		expect(leases.acquireRun(test.db, 'ws-1', 'sess-2').workstreamId).toBe('ws-1');
	});

	it('lets a prompt take over a run that only waits on background work, and nothing else', () => {
		seedRunning();
		const task = { taskId: 'b1', kind: 'command', description: 'e2e', startedAt: 1 };
		appendEvent(test.db, 'sess-1', 'run-1', 'background.updated', {
			waiting: false,
			tasks: [task],
		});
		expect(() => leases.acquireRun(test.db, 'ws-1', 'sess-1')).toThrow('already has an active run');

		appendEvent(test.db, 'sess-1', 'run-1', 'background.updated', { waiting: true, tasks: [task] });
		const takeover = leases.acquireRun(test.db, 'ws-1', 'sess-1');
		expect(takeover.handsOff).toBe(true);
		expect(() => leases.acquireRun(test.db, 'ws-1', 'sess-1')).toThrow('already has an active run');
		takeover.release();

		appendEvent(test.db, 'sess-1', 'run-1', 'background.updated', { waiting: false, tasks: [] });
		expect(() => leases.acquireRun(test.db, 'ws-1', 'sess-1')).toThrow('already has an active run');
	});

	it('lets a steering prompt into a busy run, one dispatch at a time', () => {
		seedRunning();
		expect(() => leases.acquireRun(test.db, 'ws-1', 'sess-1')).toThrow('already has an active run');

		const steer = leases.acquireRun(test.db, 'ws-1', 'sess-1', true);
		expect(steer.handsOff).toBe(true);
		expect(() => leases.acquireRun(test.db, 'ws-1', 'sess-1', true)).toThrow(
			'already has an active run',
		);
		steer.release();
	});

	it('refuses teardown of a workstream with a persisted open run without leaking its fence', () => {
		seedRunning();
		expect(() => leases.acquireWorkstreamTeardown(test.db, 'ws-1')).toThrow(
			'work stream `ws-1` has active agent runs; stop them before archiving or deleting: run-1',
		);
		run(test.db, 'UPDATE agent_runs SET completed_at = ? WHERE id = ?', 'now', 'run-1');
		const teardown = leases.acquireWorkstreamTeardown(test.db, 'ws-1');
		expect(() => leases.acquireRun(test.db, 'ws-1', 'sess-1')).toThrow(
			'work stream `ws-1` is being archived or deleted',
		);
		expect(() => leases.acquireWorkstreamTeardown(test.db, 'ws-1')).toThrow(
			'is being archived or deleted',
		);
		teardown.release();
		expect(hasActiveRun(test.db, 'ws-1')).toBe(false);
	});

	it('moves a checkout only while no run is open, and holds new runs until the move settles', async () => {
		seedRunning();
		expect(() => leases.acquireCheckoutMove(test.db, 'ws-1')).toThrow(
			"An agent is still working in this workstream, so its branch can't move yet.",
		);
		run(test.db, 'UPDATE agent_runs SET completed_at = ? WHERE id = ?', 'now', 'run-1');
		const move = leases.acquireCheckoutMove(test.db, 'ws-1');
		expect(() => leases.acquireCheckoutMove(test.db, 'ws-1')).toThrow('still working');
		let settled = false;
		const waiting = (async () => {
			await leases.checkoutSettled('ws-1');
			settled = true;
		})();
		await Promise.resolve();
		expect(settled).toBe(false);
		move.release();
		await waiting;
		expect(settled).toBe(true);
		const sending = leases.acquireRun(test.db, 'ws-1', 'sess-1');
		expect(() => leases.acquireCheckoutMove(test.db, 'ws-1')).toThrow('still working');
		sending.release();
		leases.acquireCheckoutMove(test.db, 'ws-1').release();
	});

	it('lets teardown wait out the change capture of a finished run instead of refusing', async () => {
		const first = leases.acquireRunChangeCapture('ws-1');
		const second = leases.acquireRunChangeCapture('ws-1');
		expect(() => leases.acquireWorkstreamTeardown(test.db, 'ws-1')).toThrow('active agent runs');
		let settled = false;
		const waiting = (async () => {
			await leases.runChangeCaptureSettled('ws-1');
			settled = true;
		})();
		first.release();
		await Promise.resolve();
		expect(settled).toBe(false);
		second.release();
		await waiting;
		leases.acquireWorkstreamTeardown(test.db, 'ws-1').release();
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

	it('completes a run that already replied however recovery closes it, and keeps its attachments', () => {
		const reply = 'Started the dev server.\n\nOutcome: The site runs.';
		const closers: Array<[string, () => unknown]> = [
			['bridge', () => terminalizeRunsAfterBridgeLoss(test.db, () => {})],
			['startup', () => reapOrphansOnStartup(test.db)],
			['exit', () => reapOrphansOnExit(test.db, () => {})],
			['reset', () => resetWorkstreamRuns(test.db, 'ws-reset', () => {})],
		];
		for (const [name, close] of closers) {
			seedRunning(`run-${name}`, `sess-${name}`, `ws-${name}`);
			recordOpenTurnReply(test.db, `run-${name}`, reply);
			run(
				test.db,
				`INSERT INTO agent_attachments (id, workstream_id, run_id, display_name, relative_path, media_type, size, sha256, state, created_at, expires_at, bound_at)
				 VALUES (?, ?, ?, 'a.txt', '.malini/agent-attachments/a.txt', 'text/plain', 1, 'x', 'bound', 't', NULL, 't')`,
				`att-${name.padEnd(32, '0')}`,
				`ws-${name}`,
				`run-${name}`,
			);
			close();

			expect(getRun(test.db, `run-${name}`), name).toMatchObject({ summary: reply, error: null });
			expect(getSession(test.db, `sess-${name}`)?.status, name).toBe('completed');
			expect(
				listEventRowsForSession(test.db, `sess-${name}`, 0).map(({ kind, payload }) => ({
					kind,
					payload,
				})),
				name,
			).toEqual([{ kind: 'run.completed', payload: { summary: reply } }]);
		}
		expect(
			get<{ bound: number }>(
				test.db,
				"SELECT COUNT(*) AS bound FROM agent_attachments WHERE state = 'bound'",
			),
		).toEqual({ bound: closers.length });
	});
});
