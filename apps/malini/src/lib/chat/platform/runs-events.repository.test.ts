import { describe, expect, it } from 'vitest';
import {
	agentHasReadFile,
	appendEvent,
	backgroundCommandSource,
	envelopeJson,
	eventJsonFromKindPayload,
	latestEventId,
	latestWorkstreamTurn,
	listEventRowsForSession,
	listEventsForSession,
	listOpenBackgroundCommands,
	providerResumePoint,
	turnEndedOverBackgroundCommands,
	updateEventPayload,
	workstreamHasWorkingRun,
} from './events.repository';
import { openMigratedDatabase } from '$main/db/open';
import { listAgentEventPage } from './agent/commands';
import { getInteraction, recordPendingInteraction } from './interactions.repository';
import { run, scalar } from '$main/db/rows';
import {
	activeRunWorkstreamIdentity,
	finalizeRunLifecycle,
	getRun,
	insertRun,
	listChatTurns,
	listOpenRunIds,
	listOpenRuns,
	workstreamHasOpenRun,
	type TerminalRunStatus,
} from './runs.repository';
import { getSession, insertSession } from './sessions.repository';
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

	it("knows only the files an agent Read in that workstream's own chats", () => {
		const db = openMigratedDatabase(':memory:');
		seedInteractionContext(db, 'ws-reads', 'sess-reads', 'run-reads');
		seedInteractionContext(db, 'ws-other', 'sess-other', 'run-other');
		const shot = '/tmp/shots/"quoted" shot.png';
		appendEvent(db, 'sess-reads', 'run-reads', 'tool.started', {
			name: 'Read',
			toolCallId: 't1',
			input: { file_path: shot },
		});
		appendEvent(db, 'sess-reads', 'run-reads', 'tool.started', {
			name: 'Bash',
			toolCallId: 't2',
			input: { command: 'cat /tmp/bash.png', file_path: '/tmp/bash.png' },
		});
		appendEvent(db, 'sess-other', 'run-other', 'tool.started', {
			name: 'Read',
			toolCallId: 't3',
			input: { file_path: '/tmp/other.png' },
		});

		expect(agentHasReadFile(db, 'ws-reads', shot)).toBe(true);
		expect(agentHasReadFile(db, 'ws-reads', '/tmp/shots/"quoted"')).toBe(false);
		expect(agentHasReadFile(db, 'ws-reads', '/tmp/bash.png')).toBe(false);
		expect(agentHasReadFile(db, 'ws-reads', '/tmp/other.png')).toBe(false);
		expect(agentHasReadFile(db, 'ws-other', '/tmp/other.png')).toBe(true);
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
		appendEvent(db, 'sess-cursor', 'run-3', 'background.updated', {
			waiting: true,
			tasks: [],
			summary: 'serving',
			providerCursor: 'c3',
		});
		appendEvent(db, 'sess-cursor', 'run-3', 'run.completed', { summary: 'serving' });

		expect(providerResumePoint(db, 'sess-cursor')).toEqual({ resumeAt: 'c3' });
		run(db, "UPDATE agent_runs SET obsoleted_at = 'undone' WHERE id = 'run-3'");
		expect(providerResumePoint(db, 'sess-cursor')).toEqual({ resumeAt: 'c2' });
		run(db, "UPDATE agent_runs SET obsoleted_at = 'undone' WHERE id = 'run-2'");
		expect(providerResumePoint(db, 'sess-cursor')).toEqual({ resumeAt: 'c1' });
		run(db, "UPDATE agent_runs SET obsoleted_at = 'undone' WHERE id = 'run-1'");
		expect(providerResumePoint(db, 'sess-cursor')).toEqual({ freshConversation: true });
		expect(providerResumePoint(db, 'sess-never-ran')).toEqual({});
		db.close();
	});

	it('pages a session newest whole runs first within the byte budget, always at least one run, until it is complete', () => {
		const db = openMigratedDatabase(':memory:');
		seedInteractionContext(db, 'ws-tail', 'sess-tail', 'run-1');
		seedInteractionContext(db, 'ws-other', 'sess-other', 'run-x');
		for (const id of ['run-2', 'run-3']) {
			insertRun(db, {
				id,
				sessionId: 'sess-tail',
				prompt: id,
				startedAt: '2026-07-22T00:00:02Z',
				completedAt: null,
				summary: null,
				error: null,
			});
		}
		const text = 'x'.repeat(1_000);
		const state = appendEvent(db, 'sess-tail', '', 'session.state', { status: 'idle' });
		appendEvent(db, 'sess-tail', 'run-1', 'assistant.message', { text });
		appendEvent(db, 'sess-tail', 'run-1', 'run.completed', {});
		const middle = appendEvent(db, 'sess-tail', 'run-2', 'assistant.message', { text });
		appendEvent(db, 'sess-other', 'run-x', 'assistant.message', { text });
		const middleEnd = appendEvent(db, 'sess-tail', 'run-2', 'run.completed', {});
		const newest = appendEvent(db, 'sess-tail', 'run-3', 'assistant.message', { text });
		const newestEnd = appendEvent(db, 'sess-tail', 'run-3', 'run.completed', {});
		const page = (budget: number, beforeSeq: number | null = null) => {
			const listed = listAgentEventPage(db, 'sess-tail', 0, beforeSeq, budget);
			return { ...listed, seqs: listed.envelopes.map((envelope) => envelope.seq) };
		};

		expect(page(1_000_000)).toMatchObject({ startSeq: 1, complete: true });
		expect(page(1_000_000).seqs).toHaveLength(7);
		expect(page(2_500)).toMatchObject({
			seqs: [middle, middleEnd, newest, newestEnd],
			startSeq: middle,
			complete: false,
		});
		expect(page(10)).toMatchObject({ seqs: [newest, newestEnd], overBudget: true });
		expect(page(2_500).overBudget).toBe(false);
		expect(page(10, newest).seqs).toEqual([middle, middleEnd]);
		expect(page(10, middle)).toMatchObject({ startSeq: state + 1, complete: false });
		expect(page(10, state + 1)).toMatchObject({ seqs: [state], complete: true });
		expect(listAgentEventPage(db, 'sess-tail', newest, null, 10).envelopes).toHaveLength(1);
		expect(listAgentEventPage(db, 'sess-none', 0, null, 1_000)).toEqual({
			envelopes: [],
			startSeq: 1,
			complete: true,
			overBudget: false,
		});
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

describe('what keeps running in a workstream', () => {
	const site = 'cd "/ws/apps/site" && exec npx --yes wrangler@4 dev --port 8791';

	it('lists the background commands of open runs and finds their command and output file', () => {
		const db = openMigratedDatabase(':memory:');
		seedInteractionContext(db, 'ws-run', 'sess-run', 'run-open');
		insertRun(db, {
			id: 'run-done',
			sessionId: 'sess-run',
			prompt: 'p',
			startedAt: '2026-07-22T00:00:00Z',
			completedAt: '2026-07-22T00:00:00Z',
			summary: 'ok',
			error: null,
		});
		appendEvent(db, 'sess-run', 'run-done', 'background.updated', {
			waiting: true,
			tasks: [{ taskId: 'b-old', kind: 'command', description: 'Old', startedAt: 1 }],
		});
		appendEvent(db, 'sess-run', 'run-open', 'background.updated', {
			waiting: false,
			tasks: [{ taskId: 'b-stale', kind: 'command', description: 'Stale', startedAt: 2 }],
		});
		appendEvent(db, 'sess-run', 'run-open', 'tool.started', {
			name: 'Bash',
			input: { command: site, description: 'Site preview', run_in_background: true },
			toolCallId: 'toolu_site',
		});
		appendEvent(db, 'sess-run', 'run-open', 'tool.completed', {
			name: 'Bash',
			output:
				'Command running in background with ID: b-site. Output is being written to: /private/tmp/claude-501/x/tasks/b-site.output. You will be notified when it completes.',
			toolCallId: 'toolu_site',
		});
		appendEvent(db, 'sess-run', 'run-open', 'background.updated', {
			waiting: false,
			tasks: [
				{
					taskId: 'b-site',
					kind: 'command',
					description: 'Site preview',
					startedAt: 1_792_407_085_781,
					toolCallId: 'toolu_site',
					detail: 'Ready on http://localhost:8791',
				},
				{
					taskId: 'a-helper',
					kind: 'agent',
					description: 'Helper',
					startedAt: 1_792_407_085_782,
					toolCallId: 'toolu_agent',
				},
				{ taskId: 'b-bare', kind: 'command', description: 'Bare', startedAt: 1_792_407_085_783 },
			],
		});

		expect(listOpenBackgroundCommands(db)).toEqual([
			{
				sessionId: 'sess-run',
				workstreamId: 'ws-run',
				taskId: 'b-site',
				description: 'Site preview',
				startedAt: 1_792_407_085_781,
				toolCallId: 'toolu_site',
			},
			{
				sessionId: 'sess-run',
				workstreamId: 'ws-run',
				taskId: 'b-bare',
				description: 'Bare',
				startedAt: 1_792_407_085_783,
				toolCallId: null,
			},
		]);
		expect(backgroundCommandSource(db, 'sess-run', 'toolu_site')).toEqual({
			command: site,
			outputFile: '/private/tmp/claude-501/x/tasks/b-site.output',
		});
		expect(backgroundCommandSource(db, 'sess-run', 'toolu_unknown')).toBeNull();
		db.close();
	});

	it('counts a run as working until its turn ends with only background commands left', () => {
		const db = openMigratedDatabase(':memory:');
		seedInteractionContext(db, 'ws-dev', 'sess-dev', 'run-dev');
		const server = { taskId: 'b-dev', kind: 'command', description: 'Dev server', startedAt: 1 };
		const helper = { taskId: 'a-help', kind: 'agent', description: 'Helper', startedAt: 2 };
		const background = (waiting: boolean, tasks: readonly object[]) =>
			appendEvent(db, 'sess-dev', 'run-dev', 'background.updated', { waiting, tasks });

		expect(workstreamHasWorkingRun(db, 'ws-dev')).toBe(true);
		background(false, [server]);
		expect(workstreamHasWorkingRun(db, 'ws-dev')).toBe(true);
		background(true, [server, helper]);
		expect(workstreamHasWorkingRun(db, 'ws-dev')).toBe(true);
		background(true, [server]);
		expect(workstreamHasWorkingRun(db, 'ws-dev')).toBe(false);
		expect(workstreamHasOpenRun(db, 'ws-dev')).toBe(true);
		expect(
			turnEndedOverBackgroundCommands({
				type: 'background.updated',
				waiting: true,
				tasks: [server],
			}),
		).toBe(true);
		expect(
			turnEndedOverBackgroundCommands({
				type: 'background.updated',
				waiting: true,
				tasks: [server, helper],
			}),
		).toBe(false);
		expect(
			turnEndedOverBackgroundCommands({ type: 'background.updated', waiting: true, tasks: [] }),
		).toBe(false);
		db.close();
	});

	it("reads the latest turn outcome and need from the workstream's own chats", () => {
		const db = openMigratedDatabase(':memory:');
		seedInteractionContext(db, 'ws-turn', 'sess-turn', 'run-turn');
		insertSession(
			db,
			{
				id: 'sess-job',
				workstreamId: 'ws-turn',
				model: null,
				providerSessionId: null,
				status: 'idle',
				startedAt: '2026-07-22T00:00:00Z',
			},
			{ origin: 'job', displayName: null },
		);
		expect(latestWorkstreamTurn(db, 'ws-turn')).toBeNull();

		appendEvent(db, 'sess-turn', 'run-turn', 'run.completed', {
			summary: '\nFixed the flaky build.\n\nIt waited on a stale lock.',
		});
		expect(latestWorkstreamTurn(db, 'ws-turn')).toEqual({
			endedAt: expect.any(Number),
			outcome: 'Fixed the flaky build.',
			need: null,
		});

		appendEvent(db, 'sess-turn', 'run-turn', 'background.updated', {
			waiting: true,
			tasks: [],
			summary:
				'Started the preview.\n\nOutcome: Site preview is up\nNeeds: Open localhost:8791; Check the hero',
		});
		appendEvent(db, 'sess-turn', 'run-turn', 'background.updated', { waiting: true, tasks: [] });
		appendEvent(db, 'sess-job', 'run-job', 'run.completed', { summary: 'Outcome: A job did it' });

		expect(latestWorkstreamTurn(db, 'ws-turn')).toEqual({
			endedAt: expect.any(Number),
			outcome: 'Site preview is up',
			need: 'Open localhost:8791',
		});
		expect(latestWorkstreamTurn(db, 'ws-other')).toBeNull();
		db.close();
	});
});

describe('chat turns', () => {
	it('lists the chat turns that called Malini, or the latest ones too, never a job session, with their status', () => {
		const db = openMigratedDatabase(':memory:');
		db.exec(`
			INSERT INTO projects (id, name, repo_path, default_branch, created_at) VALUES ('p', 'p', '/tmp/p', 'main', '2026-10-23T00:00:00Z');
			INSERT INTO workstreams (id, project_id, name, path, branch, base_branch, status, created_at) VALUES ('w', 'p', 'w', '/tmp/w', 'malini/w', 'main', 'active', '2026-10-23T00:00:00Z');
			INSERT INTO agent_sessions (id, workstream_id, status, started_at, display_name, origin) VALUES
			  ('chat', 'w', 'idle', '2026-10-23T00:00:00Z', 'Ship it', 'user'),
			  ('job', 'w', 'idle', '2026-10-23T00:00:00Z', 'Fix checks', 'job');
			INSERT INTO agent_runs (id, session_id, prompt, started_at, completed_at, error, obsoleted_at) VALUES
			  ('called', 'chat', '
  Clone acme/site
then hide it', '2026-10-23T10:00:00Z', '2026-10-23T10:01:00Z', NULL, NULL),
			  ('failed', 'chat', 'Try again', '2026-10-23T11:00:00Z', '2026-10-23T11:01:00Z', 'boom', NULL),
			  ('running', 'chat', 'Keep going', '2026-10-23T12:00:00Z', NULL, NULL, NULL),
			  ('edited', 'chat', 'Old prompt', '2026-10-23T09:00:00Z', '2026-10-23T09:01:00Z', NULL, '2026-10-23T09:02:00Z'),
			  ('in-job', 'job', 'Fix the checks', '2026-10-23T13:00:00Z', NULL, NULL, NULL);
		`);

		expect(listChatTurns(db, ['called', 'in-job', 'edited'], 0)).toEqual([
			{
				runId: 'called',
				sessionId: 'chat',
				workstreamId: 'w',
				chatName: 'Ship it',
				prompt: 'Clone acme/site',
				status: 'succeeded',
				startedAt: '2026-10-23T10:00:00Z',
				finishedAt: '2026-10-23T10:01:00Z',
			},
		]);
		expect(listChatTurns(db, ['called'], 2).map(({ runId, status }) => [runId, status])).toEqual([
			['running', 'running'],
			['failed', 'failed'],
			['called', 'succeeded'],
		]);
		db.close();
	});
});
