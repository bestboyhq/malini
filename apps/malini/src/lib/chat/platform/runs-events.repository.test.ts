import { describe, expect, it } from 'vitest';
import {
	appendEvent,
	envelopeJson,
	eventJsonFromKindPayload,
	latestEventId,
	listEventRowsForSession,
	listEventsForSession,
	listRecentRunEventRowsForSession,
	providerResumePoint,
	updateEventPayload,
} from './events.repository';
import { openMigratedDatabase } from '$main/db/open';
import { listRecentAgentEvents } from './agent/commands';
import { getInteraction, recordPendingInteraction } from './interactions.repository';
import { run, scalar } from '$main/db/rows';
import {
	activeRunWorkstreamIdentity,
	finalizeRunLifecycle,
	getRun,
	insertRun,
	listOpenRunIds,
	listOpenRuns,
	workstreamHasOpenRun,
	type TerminalRunStatus,
} from './runs.repository';
import { getSession } from './sessions.repository';
import { seedInteractionContext } from './test-support';

describe('events', () => {
	it('append returns a monotonic seq and replays in insertion order', () => {
		const db = openMigratedDatabase(':memory:');
		const kinds = [
			'run.started',
			'assistant.message',
			'tool.started',
			'tool.completed',
			'run.completed',
		];
		const seqs = kinds.map((kind) => appendEvent(db, 'sess-rep', 'run-rep', kind, { k: 'v' }));
		for (let index = 1; index < seqs.length; index += 1) {
			expect(seqs[index]).toBeGreaterThan(seqs[index - 1] ?? 0);
		}
		const replayed = listEventsForSession(db, 'sess-rep', 0);
		expect(replayed.map((event) => event.kind)).toEqual(kinds);
		expect(replayed[0]?.payload).toEqual({ k: 'v' });
		expect(listEventsForSession(db, 'sess-rep', seqs[0] ?? 0)).toHaveLength(kinds.length - 1);
		expect(latestEventId(db, 'sess-rep')).toBe(seqs[seqs.length - 1]);
		expect(latestEventId(db, 'sess-none')).toBe(0);
		db.close();
	});

	it('resumes at the newest run the chat still shows, and starts over once every turn is undone', () => {
		const db = openMigratedDatabase(':memory:');
		seedInteractionContext(db, 'ws-cursor', 'sess-cursor', 'run-1');
		for (const id of ['run-2', 'run-3']) {
			insertRun(db, {
				id,
				sessionId: 'sess-cursor',
				prompt: id,
				startedAt: '2026-07-22T00:00:02Z',
				completedAt: null,
				summary: null,
				error: null,
			});
		}
		appendEvent(db, 'sess-cursor', 'run-1', 'run.completed', {
			summary: 'a',
			providerCursor: 'c1',
		});
		appendEvent(db, 'sess-cursor', 'run-2', 'run.failed', { error: 'x', providerCursor: 'c2' });
		appendEvent(db, 'sess-cursor', 'run-3', 'run.failed', { error: 'interrupted' });

		expect(providerResumePoint(db, 'sess-cursor')).toEqual({ resumeAt: 'c2' });
		run(db, "UPDATE agent_runs SET obsoleted_at = 'undone' WHERE id = 'run-2'");
		expect(providerResumePoint(db, 'sess-cursor')).toEqual({ resumeAt: 'c1' });
		run(db, "UPDATE agent_runs SET obsoleted_at = 'undone' WHERE id = 'run-1'");
		expect(providerResumePoint(db, 'sess-cursor')).toEqual({ freshConversation: true });
		expect(providerResumePoint(db, 'sess-never-ran')).toEqual({});
		db.close();
	});

	it('lists a whole session within the byte budget, only its newest whole runs beyond it, and nothing when even the last run exceeds it', () => {
		const db = openMigratedDatabase(':memory:');
		const text = 'x'.repeat(1_000);
		const oldest = appendEvent(db, 'sess-tail', 'run-1', 'assistant.message', { text });
		appendEvent(db, 'sess-tail', 'run-1', 'run.completed', {});
		const middle = appendEvent(db, 'sess-tail', 'run-2', 'assistant.message', { text });
		appendEvent(db, 'sess-other', 'run-x', 'assistant.message', { text });
		const middleEnd = appendEvent(db, 'sess-tail', 'run-2', 'run.completed', {});
		const newest = appendEvent(db, 'sess-tail', 'run-3', 'assistant.message', { text });
		const newestEnd = appendEvent(db, 'sess-tail', 'run-3', 'run.completed', {});
		const seqs = (budget: number): readonly number[] =>
			listRecentRunEventRowsForSession(db, 'sess-tail', budget).map((row) => row.seq);

		expect(seqs(1_000_000)[0]).toBe(oldest);
		expect(seqs(1_000_000)).toHaveLength(6);
		expect(seqs(2_500)).toEqual([middle, middleEnd, newest, newestEnd]);
		expect(seqs(1_500)).toEqual([newest, newestEnd]);
		expect(seqs(10)).toEqual([]);
		expect(listRecentRunEventRowsForSession(db, 'sess-none', 1_000)).toEqual([]);
		db.close();
	});

	it('tells a chat too large to preload apart from an empty one', () => {
		const db = openMigratedDatabase(':memory:');
		appendEvent(db, 'sess-huge', 'run-huge', 'assistant.message', { text: 'x'.repeat(4_000) });

		expect(listRecentAgentEvents(db, 'sess-huge', 1_000)).toEqual({
			envelopes: [],
			overBudget: true,
		});
		expect(listRecentAgentEvents(db, 'sess-empty', 1_000)).toEqual({
			envelopes: [],
			overBudget: false,
		});
		expect(listRecentAgentEvents(db, 'sess-huge', 10_000).envelopes).toHaveLength(1);
		db.close();
	});

	it('list rows orders by seq, respects afterSeq, and never leaks another session', () => {
		const db = openMigratedDatabase(':memory:');
		const a = appendEvent(db, 'sess-rows', 'run-rows', 'run.started', {});
		const b = appendEvent(db, 'sess-rows', 'run-rows', 'assistant.message', { text: 'hi' });
		const c = appendEvent(db, 'sess-rows', 'run-rows', 'run.completed', { summary: 'ok' });
		appendEvent(db, 'sess-other', 'run-other', 'run.started', {});

		const rows = listEventRowsForSession(db, 'sess-rows', 0);
		expect(rows.map((row) => row.seq)).toEqual([a, b, c]);
		expect(rows[1]).toEqual({
			seq: b,
			runId: 'run-rows',
			kind: 'assistant.message',
			payload: { text: 'hi' },
		});
		expect(listEventRowsForSession(db, 'sess-rows', a).map((row) => row.kind)).toEqual([
			'assistant.message',
			'run.completed',
		]);
		expect(listEventRowsForSession(db, 'sess-rows', c)).toEqual([]);

		updateEventPayload(db, 'sess-rows', b, 'assistant.message', { text: 'edited' });
		expect(listEventRowsForSession(db, 'sess-rows', a)[0]?.payload).toEqual({ text: 'edited' });
		expect(() => updateEventPayload(db, 'sess-rows', 999, 'x', {})).toThrow(
			'expected one agent event for session `sess-rows` seq 999, updated 0',
		);
		db.close();
	});

	it('keeps a non-JSON blob readable', () => {
		const db = openMigratedDatabase(':memory:');
		run(
			db,
			"INSERT INTO agent_events (session_id, run_id, event, emitted_at) VALUES ('s', 'r', 'weird', 'now')",
		);
		expect(listEventsForSession(db, 's', 0)).toEqual([{ kind: 'weird', payload: '' }]);
		expect(eventJsonFromKindPayload('weird', '')).toEqual({ type: 'weird' });
		db.close();
	});

	it('envelope re-injects runId for ordinary kinds and sessionId only for self-identifying ones', () => {
		const env = envelopeJson(
			'sess-1',
			'run-1',
			7,
			eventJsonFromKindPayload('assistant.message', { text: 'hi' }),
		);
		expect(env).toEqual({
			sessionId: 'sess-1',
			runId: 'run-1',
			seq: 7,
			event: { type: 'assistant.message', text: 'hi', runId: 'run-1' },
		});

		const runStarted = envelopeJson(
			'sess-2',
			'run-2',
			1,
			eventJsonFromKindPayload('run.started', {}),
		);
		expect(runStarted.event).toEqual({ type: 'run.started', runId: 'run-2', sessionId: 'sess-2' });
		const sessionState = envelopeJson(
			'sess-2',
			'',
			2,
			eventJsonFromKindPayload('session.state', { status: 'running' }),
		);
		expect(sessionState.event).toEqual({
			type: 'session.state',
			status: 'running',
			sessionId: 'sess-2',
		});
		for (const kind of ['approval.requested', 'question.requested']) {
			const { event } = envelopeJson('sess-2', 'run-2', 3, eventJsonFromKindPayload(kind, {}));
			expect(event['sessionId']).toBe('sess-2');
			expect(event['runId']).toBe('run-2');
		}
		const tool = envelopeJson(
			'sess-2',
			'run-2',
			4,
			eventJsonFromKindPayload('tool.started', { name: 'Bash' }),
		).event;
		expect('sessionId' in tool).toBe(false);
	});
});

describe('runs', () => {
	it('reports open runs and the active run identity', () => {
		const db = openMigratedDatabase(':memory:');
		seedInteractionContext(db, 'workstream-open', 'session-open', 'run-open');
		expect(workstreamHasOpenRun(db, 'workstream-open')).toBe(true);
		expect(workstreamHasOpenRun(db, 'workstream-other')).toBe(false);
		expect(listOpenRunIds(db)).toEqual(['run-open']);
		expect(listOpenRuns(db)).toEqual([{ id: 'run-open', sessionId: 'session-open' }]);
		expect(activeRunWorkstreamIdentity(db, 'session-open', 'run-open')).toEqual({
			workstreamId: 'workstream-open',
			path: '/tmp/workstream-open',
		});
		expect(getRun(db, 'run-open')).toMatchObject({
			id: 'run-open',
			sessionId: 'session-open',
			completedAt: null,
		});
		db.close();
	});

	it('finalize closes the run, its pending interactions, and projects the session status', () => {
		const db = openMigratedDatabase(':memory:');
		seedInteractionContext(db, 'workstream-final', 'session-final', 'run-final');
		recordPendingInteraction(db, {
			kind: 'approval',
			sessionId: 'session-final',
			runId: 'run-final',
			requestId: 'approval-1',
			requestPayload: { approvalId: 'approval-1', reason: 'Confirm' },
			requestedAt: '2026-07-22T00:00:02Z',
		});
		const notTerminal: TerminalRunStatus = JSON.parse('"idle"');
		expect(() =>
			finalizeRunLifecycle(
				db,
				'session-final',
				'run-final',
				notTerminal,
				null,
				null,
				'2026-07-22T00:00:03Z',
			),
		).toThrow('terminal run status `idle` is invalid');
		expect(() =>
			finalizeRunLifecycle(
				db,
				'session-final',
				'run-missing',
				'failed',
				null,
				'x',
				'2026-07-22T00:00:03Z',
			),
		).toThrow('cannot finalize missing run `run-missing` for session `session-final`');

		const closed = finalizeRunLifecycle(
			db,
			'session-final',
			'run-final',
			'completed',
			'done',
			null,
			'2026-07-22T00:00:03Z',
		);
		expect(closed).toBe(1);
		expect(getRun(db, 'run-final')).toMatchObject({
			completedAt: '2026-07-22T00:00:03Z',
			summary: 'done',
			error: null,
		});
		expect(
			getInteraction(db, 'approval', 'session-final', 'run-final', 'approval-1'),
		).toMatchObject({
			state: 'closed',
			closedAt: '2026-07-22T00:00:03Z',
		});
		expect(getSession(db, 'session-final')?.status).toBe('completed');
		expect(workstreamHasOpenRun(db, 'workstream-final')).toBe(false);
		expect(activeRunWorkstreamIdentity(db, 'session-final', 'run-final')).toBeNull();
		expect(
			finalizeRunLifecycle(
				db,
				'session-final',
				'run-final',
				'failed',
				null,
				'late',
				'2026-07-22T00:00:04Z',
			),
		).toBe(0);
		expect(getRun(db, 'run-final')?.summary).toBe('done');
		expect(getSession(db, 'session-final')?.status).toBe('completed');
		expect(scalar(db, "SELECT COUNT(*) FROM agent_sessions WHERE status = 'failed'")).toBe(0);
		db.close();
	});

	it('insertRun rejects a missing session', () => {
		const db = openMigratedDatabase(':memory:');
		expect(() =>
			insertRun(db, {
				id: 'run-x',
				sessionId: 'nope',
				prompt: 'p',
				startedAt: 'now',
				completedAt: null,
				summary: null,
				error: null,
			}),
		).toThrow('cannot start run `run-x` for missing or archived agent session `nope`');
		db.close();
	});
});
