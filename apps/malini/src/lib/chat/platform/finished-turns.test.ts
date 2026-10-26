import { beforeEach, describe, expect, it } from 'vitest';
import { PAUSED_FOR_EXIT_ERROR } from '$contract/agent-state-machine';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { upsertProject, upsertWorkstream } from '$shared/repositories/repositories.platform';
import { FinishedTurns } from './finished-turns';
import { insertSession } from './sessions.repository';

const NOW = '2026-10-26T09:00:00.000Z';

const REPORT =
	'Added the endpoint.\n\nOutcome: The endpoint answers\nNeeds: A Logdash key; A project name';

let db: MaliniDatabase;
let turns: FinishedTurns;
let seq = 0;

beforeEach(() => {
	db = openMigratedDatabase(':memory:');
	upsertProject(db, {
		id: 'project',
		name: 'project',
		repoPath: '/tmp/project',
		defaultBranch: 'main',
		createdAt: NOW,
	});
	upsertWorkstream(db, {
		id: 'ws-1',
		projectId: 'project',
		name: 'ws-1',
		path: '/tmp/ws-1',
		branch: 'malini/ws-1',
		baseBranch: 'main',
		status: 'active',
		createdAt: NOW,
		scope: null,
		startedBy: null,
	});
	for (const [id, origin] of [
		['chat', 'user'],
		['job', 'job'],
	] as const) {
		insertSession(
			db,
			{
				id,
				workstreamId: 'ws-1',
				model: null,
				providerSessionId: null,
				status: 'idle',
				startedAt: NOW,
			},
			{ origin, displayName: id },
		);
	}
	turns = new FinishedTurns(db);
});

function after(sessionId: string, runId: string, event: Record<string, unknown>) {
	seq += 1;
	return turns.after({ sessionId, runId, seq, event: { runId, ...event } });
}

describe('FinishedTurns', () => {
	it("tells once that a chat's turn ended, with its report", () => {
		expect(after('chat', 'run-1', { type: 'run.completed', summary: REPORT })).toEqual({
			workstreamId: 'ws-1',
			sessionId: 'chat',
			runId: 'run-1',
			status: 'succeeded',
			outcome: 'The endpoint answers',
			needs: 'A Logdash key; A project name',
		});
		expect(after('chat', 'run-1', { type: 'run.completed', summary: REPORT })).toBeNull();
	});

	it('tells of a turn that ended over background commands, a failed one and a stopped one', () => {
		const ended = [
			after('chat', 'run-1', {
				type: 'background.updated',
				waiting: true,
				tasks: [{ taskId: 'dev', kind: 'command', description: 'Dev server', startedAt: 1 }],
				summary: 'Started the server.\n\nOutcome: It serves\nNeeds: nothing',
			}),
			after('chat', 'run-2', { type: 'run.failed', error: 'model overloaded' }),
			after('chat', 'run-3', { type: 'run.failed', error: 'cancelled by user' }),
		];

		expect(ended.map((turn) => [turn?.runId, turn?.status, turn?.needs])).toEqual([
			['run-1', 'succeeded', null],
			['run-2', 'failed', null],
			['run-3', 'cancelled', null],
		]);
	});

	it('stays quiet for job sessions, for turns Malini paused to quit, and mid-turn', () => {
		expect(after('job', 'run-1', { type: 'run.completed', summary: REPORT })).toBeNull();
		expect(after('chat', 'run-2', { type: 'run.failed', error: PAUSED_FOR_EXIT_ERROR })).toBeNull();
		expect(after('chat', 'run-3', { type: 'assistant.message', text: 'Working on it' })).toBeNull();
	});
});
