import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { run } from '$main/db/rows';
import { seedWorkstream } from '$main/db/test-fixtures';
import { deleteWorkstream } from '$shared/repositories/repositories.platform';
import { captureTypedChats, type CaptureScope } from './brain-capture.service';
import { uncapturedPrompts } from './brain-store.repository';

const SECRET = 'sk-live-correct-horse-battery';
const NOW = new Date(2026, 10, 7, 9, 30);
const DAY_FILE = 'log/2026-11-07.md';

let db: MaliniDatabase;
let checkout: string;
let scope: CaptureScope;
let runs = 0;

function workstream(id: string, place: 'archived' | 'active' | 'home'): void {
	seedWorkstream(db, id);
	if (place === 'archived') run(db, "UPDATE workstreams SET status = 'archived' WHERE id = ?", id);
	if (place === 'home') run(db, "UPDATE workstreams SET scope = 'home' WHERE id = ?", id);
}

function chat(sessionId: string, workstreamId: string, name: string, origin = 'user'): void {
	run(
		db,
		`INSERT INTO agent_sessions (id, workstream_id, status, started_at, display_name, origin)
		 VALUES (?, ?, 'idle', '2026-11-07T08:00:00Z', ?, ?)`,
		sessionId,
		workstreamId,
		name,
		origin,
	);
}

type Turn = Readonly<{
	payload?: Record<string, unknown>;
	reply?: string;
	finished?: boolean;
	automated?: boolean;
}>;

function turn(sessionId: string, prompt: string, options: Turn = {}): string {
	runs += 1;
	const runId = `run-${runs}`;
	const finished = options.finished ?? true;
	const reply = options.reply ?? `Done.\n\nOutcome: Shipped ${prompt.slice(0, 12)}\nNeeds: nothing`;
	run(
		db,
		`INSERT INTO agent_runs (id, session_id, prompt, started_at, completed_at, summary, automated)
		 VALUES (?, ?, ?, '2026-11-07T08:00:01Z', ?, ?, ?)`,
		runId,
		sessionId,
		prompt,
		finished ? '2026-11-07T08:01:00Z' : null,
		finished ? reply : null,
		options.automated ? 1 : 0,
	);
	const event = (kind: string, payload: Record<string, unknown>): void => {
		run(
			db,
			`INSERT INTO agent_events (session_id, run_id, event, emitted_at)
			 VALUES (?, ?, ?, '2026-11-07T08:00:02Z')`,
			sessionId,
			runId,
			`${kind}\n${JSON.stringify(payload)}`,
		);
	};
	event('user.message', { text: prompt, ...options.payload });
	event('assistant.message', { text: `ASSISTANT SAID ${SECRET}` });
	return runId;
}

async function capture(): Promise<string> {
	await captureTypedChats(db, scope);
	return readFile(join(checkout, DAY_FILE), 'utf8').catch(() => '');
}

beforeEach(async () => {
	db = openMigratedDatabase(':memory:');
	checkout = await mkdtemp(join(tmpdir(), 'malini-brain-'));
	scope = {
		checkout,
		brainProjectId: null,
		sinceSeq: 0,
		secrets: [SECRET],
		home: '/Users/ada',
		now: NOW,
	};
	runs = 0;
});

afterEach(async () => {
	db.close();
	await rm(checkout, { recursive: true, force: true });
});

describe('capturing typed chats into the brain log', () => {
	it('appends what you typed in archived and Home chats with each Outcome, never the assistant', async () => {
		workstream('ws-archived', 'archived');
		workstream('ws-active', 'active');
		workstream('ws-home', 'home');
		chat('chat-archived', 'ws-archived', 'Fix the login loop');
		chat('chat-active', 'ws-active', 'Still going');
		chat('chat-home', 'ws-home', 'Plan the week');
		turn('chat-archived', `Deploy with ${SECRET} and ghp_${'a'.repeat(36)}`);
		turn('chat-active', 'Not archived yet');
		turn('chat-home', 'What ships Friday');

		const log = await capture();

		expect(log.startsWith('# 2026-11-07\n\n## Fix the login loop - ')).toBe(true);
		expect(log).toContain('> Deploy with [secret] and [redacted-token]');
		expect(log).toContain('Outcome: Shipped Deploy with');
		expect(log).toContain(
			'## Plan the week - Home\n\n> What ships Friday\n\nOutcome: Shipped What ships ',
		);
		expect(log).not.toContain('Not archived yet');
		expect(log).not.toContain('ASSISTANT SAID');
		expect(log).not.toContain(SECRET);
		expect(log).not.toContain('ghp_');
	});

	it('adds nothing on a second capture, then only the turns that came after', async () => {
		workstream('ws-home', 'home');
		chat('chat-home', 'ws-home', 'Plan the week');
		turn('chat-home', 'First question');
		const first = await capture();

		expect(await captureTypedChats(db, scope)).toEqual({ chats: 0, turns: 0, logPath: null });
		expect(await readFile(join(checkout, DAY_FILE), 'utf8')).toBe(first);

		turn('chat-home', 'Second question');
		const second = await capture();
		expect(second.startsWith(first)).toBe(true);
		expect(second.slice(first.length)).toBe(
			'\n## Plan the week - Home\n\n> Second question\n\nOutcome: Shipped Second quest\n',
		);
	});

	it('captures nothing of a deleted workstream', async () => {
		workstream('ws-gone', 'archived');
		chat('chat-gone', 'ws-gone', 'Thrown away');
		turn('chat-gone', 'Never keep this');
		deleteWorkstream(db, 'ws-gone');

		expect(await captureTypedChats(db, scope)).toEqual({ chats: 0, turns: 0, logPath: null });
		expect(uncapturedPrompts(db, null, 0)).toEqual([]);
	});

	it('skips the brain, automations, prompts other chats sent and turns from before the brain', async () => {
		workstream('ws-brain', 'archived');
		workstream('ws-home', 'home');
		chat('chat-brain', 'ws-brain', 'Inside the brain');
		chat('chat-home', 'ws-home', 'Plan the week');
		chat('chat-automation', 'ws-home', 'An automation', 'automation');
		turn('chat-brain', 'About the brain itself');
		turn('chat-home', 'Before the brain existed');
		const sinceSeq = 4;
		turn('chat-home', 'Sent by the lead', { payload: { from: 'lead' } });
		turn('chat-home', 'Started by an automation', { automated: true });
		turn('chat-automation', 'Automation chat');
		turn('chat-home', 'Typed after');

		const log = await captureTypedChats(db, {
			...scope,
			sinceSeq,
			brainProjectId: 'project-ws-brain',
		});

		expect(log).toEqual({ chats: 1, turns: 1, logPath: DAY_FILE });
		const text = await readFile(join(checkout, DAY_FILE), 'utf8');
		expect(text).toContain('> Typed after');
		for (const left of [
			'About the brain',
			'Before the brain',
			'Sent by',
			'Started by',
			'Automation chat',
		]) {
			expect(text).not.toContain(left);
		}
	});

	it('waits for a turn still running and captures it once it finishes', async () => {
		workstream('ws-home', 'home');
		chat('chat-home', 'ws-home', 'Plan the week');
		turn('chat-home', 'Done turn');
		const running = turn('chat-home', 'Running turn', { finished: false });

		expect(await capture()).not.toContain('Running turn');

		run(
			db,
			"UPDATE agent_runs SET completed_at = '2026-11-07T09:00:00Z', summary = 'Outcome: Finally' WHERE id = ?",
			running,
		);
		const log = await capture();
		expect(log).toContain('> Running turn\n\nOutcome: Finally\n');
		expect(log.match(/> Done turn/gu)).toHaveLength(1);
	});
});
