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
	it('describes the work the user asked for, never what jobs or malini prompted', () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db, WORKSTREAM);
		expect(workstreamShipContext(db, WORKSTREAM)).toEqual({});

		session(db, 'chat-old', 'user', 'Health endpoint');
		completedRun(
			db,
			'run-health',
			'chat-old',
			'Add a health endpoint',
			'Added the /health endpoint',
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
		completedRun(
			db,
			'run-fix',
			'chat-old',
			'Resolve the merge conflicts',
			'Resolved conflicts in src/app.ts',
			true,
		);

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
			runSummaries: [
				'Added the /health endpoint',
				'Wired the readiness probe. Pull request: Add health and readiness probes',
			],
			latestRunId: 'run-probe',
			pullRequestTitle: 'Add health and readiness probes',
			events: [{ kind: 'validation', label: 'pnpm test', status: 'passed' }],
		});
		db.close();
	});

	it('names the run the commit subject comes from, never a later run without a useful summary', () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db, WORKSTREAM);
		session(db, 'chat', 'user', 'Alpha');
		completedRun(db, 'run-alpha', 'chat', 'Add alpha', 'Commit: feat: add alpha');
		completedRun(db, 'run-beta', 'chat', 'EDIT:beta.txt', 'done');

		expect(workstreamShipContext(db, WORKSTREAM)).toMatchObject({
			lastUserIntent: 'EDIT:beta.txt',
			runSummaries: ['feat: add alpha'],
			latestRunId: 'run-alpha',
		});
		db.close();
	});
});
