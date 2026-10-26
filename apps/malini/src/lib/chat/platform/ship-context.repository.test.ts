import { describe, expect, it } from 'vitest';
import { openMigratedDatabase } from '$main/db/open';
import { run } from '$main/db/rows';
import { seedWorkstream } from '$main/db/test-fixtures';
import type { MaliniDatabase } from '$main/db/driver';
import { appendEvent } from './events.repository';
import { insertRun } from './runs.repository';
import { insertSession } from './sessions.repository';
import { workstreamShipContext } from './ship-context.repository';

const WORKSTREAM = 'ws-ship';

function session(
	db: MaliniDatabase,
	id: string,
	origin: 'user' | 'job',
	displayName: string,
): void {
	insertSession(
		db,
		{
			id,
			workstreamId: WORKSTREAM,
			model: null,
			providerSessionId: null,
			status: 'idle',
			startedAt: '2026-07-10T00:00:00Z',
		},
		{ origin, displayName },
	);
}

function completedRun(
	db: MaliniDatabase,
	id: string,
	sessionId: string,
	prompt: string,
	summary: string,
	automated = false,
): void {
	insertRun(db, {
		id,
		sessionId,
		prompt,
		startedAt: '2026-07-10T00:00:00Z',
		completedAt: '2026-07-10T00:01:00Z',
		summary,
		error: null,
		automated,
	});
}

describe('workstreamShipContext', () => {
	it('describes the work the user asked for, never what jobs did', () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db, WORKSTREAM);
		expect(workstreamShipContext(db, WORKSTREAM)).toEqual({});

		session(db, 'chat-old', 'user', 'Health endpoint');
		completedRun(
			db,
			'run-health',
			'chat-old',
			'Add a health endpoint',
			'Added the /health endpoint.\n\nCommit: Add the /health endpoint',
		);
		appendEvent(db, 'chat-old', 'run-health', 'command.completed', {
			runId: 'run-health',
			command: 'pnpm test > out.log',
			exitCode: 0,
		});
		appendEvent(db, 'chat-old', 'run-health', 'command.completed', {
			runId: 'run-health',
			command: 'pnpm lint',
			exitCode: 1,
		});
		completedRun(db, 'run-ack', 'chat-old', 'thanks', 'Done.');

		session(db, 'chat-new', 'user', 'Readiness probe');
		completedRun(
			db,
			'run-probe',
			'chat-new',
			'Wire [[context:src/probe.ts]] into the readiness probe',
			'Wired the readiness probe. Pull request: Add health and readiness probes',
		);
		completedRun(db, 'run-undone', 'chat-new', 'Rename everything', 'Renamed every module');
		run(db, "UPDATE agent_runs SET obsoleted_at = '2026-07-10T00:02:00Z' WHERE id = 'run-undone'");

		session(db, 'job', 'job', 'Fix checks');
		completedRun(db, 'run-job', 'job', 'Fix the failing checks', 'Fixed the lint errors', true);
		completedRun(db, 'run-steer', 'job', 'Also bump the timeout', 'Bumped the CI timeout');

		expect(workstreamShipContext(db, WORKSTREAM)).toEqual({
			sessionTitle: 'Readiness probe',
			lastUserIntent: 'Wire into the readiness probe',
			runSummaries: ['Add the /health endpoint'],
			latestRunId: 'run-health',
			pullRequestTitle: 'Add health and readiness probes',
			events: [{ kind: 'validation', label: 'pnpm test', status: 'passed' }],
		});
		db.close();
	});

	it('names the run the commit subject comes from, never a later reply without a Commit line', () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db, WORKSTREAM);
		session(db, 'chat', 'user', 'Alpha');
		completedRun(db, 'run-alpha', 'chat', 'Add alpha', 'Commit: feat: add alpha');
		completedRun(db, 'run-beta', 'chat', 'EDIT:beta.txt', 'done');
		completedRun(db, 'run-sorry', 'chat', 'why so slow?', 'Sorry, this took far too long');

		expect(workstreamShipContext(db, WORKSTREAM)).toMatchObject({
			lastUserIntent: 'why so slow?',
			runSummaries: ['feat: add alpha'],
			latestRunId: 'run-alpha',
		});
		db.close();
	});

	it('titles the pull request after the latest run that proposed a title, a job included', () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db, WORKSTREAM);
		session(db, 'chat', 'user', 'Jobs panel');
		completedRun(
			db,
			'run-user',
			'chat',
			'idk why : jobs',
			'Commit: x\nPull request: Idk why : jobs',
		);
		session(db, 'job', 'job', 'Fix checks');
		completedRun(
			db,
			'run-fix',
			'job',
			'Fix the failing checks',
			'Only the title fails the check.\n\nPull request: feat(jobs): dock the Job center',
			true,
		);
		completedRun(db, 'run-quiet', 'job', 'Fix the failing checks', 'Nothing to change.', true);

		expect(workstreamShipContext(db, WORKSTREAM)).toMatchObject({
			runSummaries: ['x'],
			latestRunId: 'run-user',
			pullRequestTitle: 'feat(jobs): dock the Job center',
		});
		db.close();
	});

	it('ships what a run malini continued after a restart did, under the prompt the user typed', () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db, WORKSTREAM);
		session(db, 'chat', 'user', 'Jobs panel');
		insertRun(db, {
			id: 'run-paused',
			sessionId: 'chat',
			prompt: 'Make every job a one-liner',
			startedAt: '2026-07-10T00:00:00Z',
			completedAt: '2026-07-10T00:01:00Z',
			summary: null,
			error: 'paused: malini closed mid-run',
		});
		completedRun(
			db,
			'run-continued',
			'chat',
			'Malini restarted while you were working',
			'Docked the panel.\n\nCommit: Dock the jobs panel\nPull request: feat: dock the jobs panel',
			true,
		);

		expect(workstreamShipContext(db, WORKSTREAM)).toMatchObject({
			lastUserIntent: 'Make every job a one-liner',
			runSummaries: ['Dock the jobs panel'],
			latestRunId: 'run-continued',
			pullRequestTitle: 'feat: dock the jobs panel',
		});
		db.close();
	});

	it('records each variant the user picked against the variants the run before offered', () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db, WORKSTREAM);
		session(db, 'chat', 'user', 'Hero');
		completedRun(
			db,
			'run-offer',
			'chat',
			'Give me hero directions',
			'![Variant A: Calm](a.png)\n![Variant B: Bold](b.png)\n\nOutcome: Two directions.',
		);
		completedRun(db, 'run-undone', 'chat', 'Go with variant A (Calm).', 'Outcome: Built A.');
		run(db, "UPDATE agent_runs SET obsoleted_at = '2026-07-10T00:02:00Z' WHERE id = 'run-undone'");
		completedRun(
			db,
			'run-pick',
			'chat',
			'Go with variant B (Bold).\nWhy: darker reads better',
			'Outcome: Built B.',
		);

		expect(workstreamShipContext(db, WORKSTREAM).decisions).toEqual([
			'B · Bold over A · Calm - "darker reads better"',
		]);
		db.close();
	});
});
