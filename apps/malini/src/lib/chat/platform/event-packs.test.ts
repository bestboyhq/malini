import { existsSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL } from '$contract/events';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { all, column, get, run, scalar } from '$main/db/rows';
import { seedWorkstream } from '$main/db/test-fixtures';
import { createEventBus } from '$main/events';
import { deleteWorkstream } from '$shared/repositories/repositories.platform';
import { listAgentEventPage } from './agent/commands';
import { packSessionEvents, unpackSessionEvents } from './event-packs.repository';
import { packArchivedChats, unpackRestoredChats } from './event-packs.service';
import {
	appendEvent,
	listEventRowsForSession,
	listEventRowsOfKinds,
	toolCallOutput,
	type AgentEventRow,
} from './events.repository';
import { insertRun } from './runs.repository';
import { archiveSession, insertSession } from './sessions.repository';

const BUILD_LOG = `${'compiled one more module of the app\n'.repeat(2_000)}done`;

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	while (cleanups.length > 0) await cleanups.pop()?.();
});

function seedChat(db: MaliniDatabase, workstreamId: string, sessionId: string): void {
	insertSession(db, {
		id: sessionId,
		workstreamId,
		model: null,
		providerSessionId: null,
		status: 'idle',
		startedAt: '2026-10-27T10:00:00Z',
	});
	const turns: Array<[string, Array<[string, unknown]>]> = [
		[
			'Fix the build',
			[
				['thinking.message', { contentId: 'm:0', text: 'The build log says why.' }],
				[
					'tool.started',
					{ name: 'Bash', toolCallId: `${sessionId}-bash`, input: { command: 'pnpm build' } },
				],
				['tool.completed', { name: 'Bash', toolCallId: `${sessionId}-bash`, output: BUILD_LOG }],
				['command.completed', { command: 'pnpm build', exitCode: 0 }],
				['assistant.message', { text: 'Fixed the build.' }],
			],
		],
		[
			'Show the screenshot',
			[
				[
					'tool.started',
					{ name: 'Read', toolCallId: `${sessionId}-read`, input: { file_path: '/tmp/shot.png' } },
				],
				['tool.failed', { name: 'Read', toolCallId: `${sessionId}-read`, error: 'It is gone.' }],
				['assistant.message', { text: 'The screenshot is gone.' }],
			],
		],
	];
	turns.forEach(([prompt, events], index) => {
		const runId = `${sessionId}-run-${index + 1}`;
		insertRun(db, {
			id: runId,
			sessionId,
			prompt,
			startedAt: `2026-10-27T10:0${index}:01Z`,
			completedAt: `2026-10-27T10:0${index}:59Z`,
			summary: null,
			error: null,
		});
		appendEvent(db, sessionId, runId, 'run.started', {});
		appendEvent(db, sessionId, runId, 'user.message', { text: prompt });
		for (const [kind, payload] of events) appendEvent(db, sessionId, runId, kind, payload);
		appendEvent(db, sessionId, runId, 'run.completed', { summary: prompt });
	});
	run(
		db,
		`UPDATE agent_events
		 SET emitted_at = strftime('%Y-%m-%dT%H:%M:%fZ', '2026-10-27T10:00:00Z', seq || ' seconds')
		 WHERE session_id = ?`,
		sessionId,
	);
}

type Transcript = ReturnType<typeof transcript>;

function recordedTimes(db: MaliniDatabase): Map<number, string> {
	return new Map(
		all<{ seq: number; emitted_at: string }>(db, 'SELECT seq, emitted_at FROM agent_events').map(
			(row) => [row.seq, row.emitted_at],
		),
	);
}

function readBackPacked(
	db: MaliniDatabase,
	before: Transcript,
	recorded: ReadonlyMap<number, string>,
): Transcript {
	const loose = new Set(
		all<{ seq: number }>(db, 'SELECT seq FROM agent_events').map((row) => row.seq),
	);
	const timed = (rows: readonly AgentEventRow[]): AgentEventRow[] =>
		rows.map((row) => {
			const at = recorded.get(row.seq);
			return loose.has(row.seq) || at === undefined ? row : { ...row, at };
		});
	return { ...before, rows: timed(before.rows), tail: timed(before.tail) };
}

function transcript(db: MaliniDatabase, sessionId: string) {
	const rows = listEventRowsForSession(db, sessionId, 0);
	return {
		rows,
		tail: listEventRowsForSession(db, sessionId, rows[3]?.seq ?? 0),
		lastTurn: listAgentEventPage(db, sessionId, 0, null, 5_000),
		conversation: listEventRowsOfKinds(
			db,
			sessionId,
			['user.message', 'assistant.message', 'tool.started', 'run.completed'],
			['user.message', 'assistant.message'],
		),
		buildLog: toolCallOutput(db, sessionId, `${sessionId}-bash`),
		runs: all(
			db,
			'SELECT id, event_bytes, first_seq FROM agent_runs WHERE session_id = ? ORDER BY id',
			sessionId,
		),
	};
}

function storedEvents(db: MaliniDatabase): unknown[] {
	return all(
		db,
		'SELECT seq, session_id, run_id, event, emitted_at FROM agent_events ORDER BY seq',
	);
}

function looseKinds(db: MaliniDatabase, sessionId: string): string[] {
	return column(
		db,
		`SELECT substr(event, 1, instr(event, char(10)) - 1) FROM agent_events
		 WHERE session_id = ? ORDER BY seq`,
		sessionId,
	);
}

function packedChats(db: MaliniDatabase): string[] {
	return column(db, 'SELECT session_id FROM agent_event_packs ORDER BY session_id');
}

function archiveWorkstream(db: MaliniDatabase, workstreamId: string): void {
	run(
		db,
		"UPDATE workstreams SET status = 'archived', archived_at = '2026-10-27T11:00:00Z' WHERE id = ?",
		workstreamId,
	);
}

function restoreWorkstream(db: MaliniDatabase, workstreamId: string): void {
	run(
		db,
		"UPDATE workstreams SET status = 'active', archived_at = NULL WHERE id = ?",
		workstreamId,
	);
}

describe('archived chat packs', () => {
	it('packs the tool calls, their output and the thinking of a closed chat, and reads it back unchanged, with when Malini recorded each event', () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db, 'ws');
		seedChat(db, 'ws', 'chat');
		const before = transcript(db, 'chat');
		const recorded = recordedTimes(db);
		expect(before.lastTurn.complete).toBe(false);
		expect(before.lastTurn.envelopes.map(({ seq, emittedAt }) => [seq, emittedAt])).toEqual(
			before.lastTurn.envelopes.map(({ seq }) => [seq, recorded.get(seq)]),
		);

		archiveSession(db, 'chat', '2026-10-27T11:00:00Z');
		packSessionEvents(db, 'chat');

		expect(looseKinds(db, 'chat')).toEqual([
			'run.started',
			'user.message',
			'assistant.message',
			'run.completed',
			'run.started',
			'user.message',
			'assistant.message',
			'run.completed',
		]);
		expect(transcript(db, 'chat')).toEqual(readBackPacked(db, before, recorded));
		const pack = get<{ events: Uint8Array }>(db, 'SELECT events FROM agent_event_packs');
		expect(pack?.events.byteLength).toBeLessThan(BUILD_LOG.length / 20);

		packSessionEvents(db, 'chat');
		expect(get(db, 'SELECT events FROM agent_event_packs')).toEqual(pack);
		db.close();
	});

	it('packs a chat only while its workstream is archived, and puts back every event as it was', () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db, 'ws');
		seedChat(db, 'ws', 'chat');
		const stored = storedEvents(db);
		const before = transcript(db, 'chat');
		const recorded = recordedTimes(db);
		const toolCalls = all(db, 'SELECT run_id, tool, calls FROM agent_run_tool_calls ORDER BY 1, 2');
		expect(toolCalls).not.toEqual([]);

		packSessionEvents(db, 'chat');
		expect(packedChats(db)).toEqual([]);
		expect(storedEvents(db)).toEqual(stored);

		archiveWorkstream(db, 'ws');
		packSessionEvents(db, 'chat');
		unpackSessionEvents(db, 'chat');
		expect(packedChats(db)).toEqual(['chat']);
		expect(transcript(db, 'chat')).toEqual(readBackPacked(db, before, recorded));

		restoreWorkstream(db, 'ws');
		unpackSessionEvents(db, 'chat');
		expect(packedChats(db)).toEqual([]);
		expect(storedEvents(db)).toEqual(stored);
		expect(transcript(db, 'chat')).toEqual(before);
		expect(all(db, 'SELECT run_id, tool, calls FROM agent_run_tool_calls ORDER BY 1, 2')).toEqual(
			toolCalls,
		);
		db.close();
	});

	it('forgets the packs of chats whose workstream is deleted', () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db, 'ws');
		seedChat(db, 'ws', 'chat');
		archiveWorkstream(db, 'ws');
		packSessionEvents(db, 'chat');
		expect(packedChats(db)).toEqual(['chat']);

		deleteWorkstream(db, 'ws');
		expect(packedChats(db)).toEqual([]);
		db.close();
	});

	it('packs archived chats at start and on archive, unpacks restored ones, and frees the disk', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'malini-packs-'));
		cleanups.push(() => rm(dir, { recursive: true, force: true }));
		const path = join(dir, 'malini.sqlite');
		const db = openMigratedDatabase(path);
		seedWorkstream(db, 'ws-old');
		seedChat(db, 'ws-old', 'old-chat');
		for (let call = 0; call < 40; call += 1) {
			appendEvent(db, 'old-chat', 'old-chat-run-1', 'tool.completed', {
				name: 'Bash',
				toolCallId: `call-${call}`,
				output: `${call} ${BUILD_LOG}`,
			});
		}
		seedWorkstream(db, 'ws-back');
		seedChat(db, 'ws-back', 'back-chat');
		archiveWorkstream(db, 'ws-back');
		packSessionEvents(db, 'back-chat');
		restoreWorkstream(db, 'ws-back');
		seedWorkstream(db, 'ws-live');
		seedChat(db, 'ws-live', 'live-chat');
		archiveWorkstream(db, 'ws-old');
		db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
		const sizeBefore = statSync(path).size;

		const events = createEventBus({ forwardToWindows: false });
		const packing = packArchivedChats({ db, events });
		try {
			await vi.waitFor(() => expect(scalar(db, 'PRAGMA auto_vacuum')).toBe(2));
			expect(packedChats(db)).toEqual(['old-chat']);
			expect(statSync(path).size).toBeLessThan(sizeBefore / 4);
			expect(existsSync(`${path}-wal`) ? statSync(`${path}-wal`).size : 0).toBe(0);

			restoreWorkstream(db, 'ws-old');
			unpackRestoredChats(db);
			expect(packedChats(db)).toEqual([]);
			expect(toolCallOutput(db, 'old-chat', 'call-39')).toBe(`39 ${BUILD_LOG}`);

			archiveWorkstream(db, 'ws-live');
			events.emit(REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL, {
				workstreamId: 'ws-live',
				worktreePath: '/tmp/ws-live',
				archived: true,
			});
			await vi.waitFor(() => expect(packedChats(db)).toEqual(['live-chat']));
		} finally {
			await packing.stop();
			db.close();
		}
	});
});
