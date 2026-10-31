import { describe, expect, it } from 'vitest';
import type { MaliniDatabase } from '$main/db/driver';
import { run } from '$main/db/rows';
import { appendEvent } from '../events.repository';
import { insertRun } from '../runs.repository';
import { openChatTestDatabase, seedChatSession, seedChatWorkstream } from '../test-support';
import { conversationRecord } from './sessions';

const SESSION = 'session-record';

function chat(): MaliniDatabase {
	const db = openChatTestDatabase();
	seedChatWorkstream(db, 'ws-record', '/tmp/ws-record');
	seedChatSession(db, SESSION, 'ws-record');
	return db;
}

function turn(
	db: MaliniDatabase,
	runId: string,
	events: ReadonlyArray<readonly [string, Record<string, unknown>]>,
): number[] {
	insertRun(db, {
		id: runId,
		sessionId: SESSION,
		prompt: '',
		startedAt: '2026-10-31T10:00:00Z',
		completedAt: null,
		summary: null,
		error: null,
	});
	return events.map(([kind, payload]) => appendEvent(db, SESSION, runId, kind, payload));
}

describe('conversationRecord', () => {
	it('keeps every message the user saw, cut turns included, without undone ones', () => {
		const db = chat();
		turn(db, 'run-kept', [
			['user.message', { text: 'Plan the move' }],
			['assistant.message', { text: 'Looking around.' }],
			['tool.started', { name: 'Bash', toolCallId: 'bash-1', input: { command: 'ls' } }],
			['tool.completed', { name: 'Bash', toolCallId: 'bash-1', output: 'private notes' }],
			['assistant.message', { text: 'Started the move.' }],
			['run.completed', {}],
		]);
		turn(db, 'run-cut', [
			['user.message', { text: 'Also check the docs' }],
			['assistant.message', { text: 'Checking the docs.' }],
			['run.failed', { error: 'cancelled' }],
		]);
		turn(db, 'run-undone', [
			['user.message', { text: 'Forget the docs' }],
			['run.completed', {}],
		]);
		run(db, `UPDATE agent_runs SET obsoleted_at = ? WHERE id = 'run-undone'`, 'x');
		const rewound = turn(db, 'run-rewound', [
			['user.message', { text: 'Rewound prompt' }],
			['assistant.message', { text: 'Rewound reply' }],
			['run.completed', {}],
		]);
		appendEvent(db, SESSION, 'run-kept', 'turn.superseded', {
			fromSeq: rewound[0],
			toSeq: rewound.at(-1),
		});
		turn(db, 'run-now', [['user.message', { text: '/compact' }]]);

		expect(conversationRecord(db, SESSION)).toEqual([
			{ role: 'user', content: 'Plan the move' },
			{ role: 'assistant', content: 'Looking around.\n\nStarted the move.' },
			{ role: 'user', content: 'Also check the docs' },
			{ role: 'assistant', content: 'Checking the docs.' },
			{ role: 'user', content: '/compact' },
		]);
	});

	it('keeps the newest messages that fit what the bridge accepts', () => {
		const db = chat();
		turn(
			db,
			'run-long',
			Array.from({ length: 400 }, (_, index) => [
				'user.message',
				{ text: `${index} ${'x'.repeat(1_000)}` },
			]),
		);

		const record = conversationRecord(db, SESSION) ?? [];

		expect(Buffer.byteLength(JSON.stringify(record))).toBeLessThanOrEqual(256 * 1024);
		expect(record.length).toBeLessThan(400);
		expect(record.at(-1)?.content.startsWith('399 ')).toBe(true);
	});

	it('has no record for a chat without messages', () => {
		expect(conversationRecord(chat(), SESSION)).toBeNull();
	});
});
