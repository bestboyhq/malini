import { describe, expect, it } from 'vitest';
import { openMigratedDatabase } from '$main/db/open';
import { listPermissionRules } from './permissions.repository';
import { all, run, scalar } from '$main/db/rows';
import { insertRun } from './runs.repository';
import {
	agentSessionBelongsToWorkstream,
	archiveSession,
	conciseSessionTitle,
	discardUnregisteredSession,
	ensureSessionDisplayNames,
	getSession,
	insertSession,
	latestSessionForWorkstream,
	listSessionSummaries,
	nameSession,
	sessionHasUserRun,
	repairSessionStatusesWithoutOpenRuns,
	sessionContextIdentity,
	setProviderSessionId,
	setSessionModel,
	setSessionStatus,
	type AgentSession,
} from './sessions.repository';
import { seedWorkstream } from '$main/db/test-fixtures';
import { seedInteractionContext } from './test-support';

function session(
	id: string,
	workstreamId: string,
	extra: Partial<AgentSession> = {},
): AgentSession {
	return {
		id,
		workstreamId,
		model: 'anthropic/claude-sonnet-4-6',
		providerSessionId: null,
		status: 'idle',
		startedAt: '2026-07-10T00:00:00Z',
		...extra,
	};
}

describe('conciseSessionTitle', () => {
	it('removes request scaffolding and caps width', () => {
		expect(
			conciseSessionTitle('  Could you please fix the refresh token flow before reconnecting?  '),
		).toBe('Fix the refresh token flow before reconnecting');
		expect(
			conciseSessionTitle(
				'Okay, so I want you to make the composer feel dramatically cleaner and faster today',
			),
		).toBe('Make the composer feel dramatically cleaner');
		expect(
			conciseSessionTitle('Review the uncommitted agent bridge changes in this workstream'),
		).toBe('Review the uncommitted agent bridge changes');
		expect(
			conciseSessionTitle('You are the constrained workstream environment planning agent.'),
		).toBe('You are the constrained workstream environment');
		expect(conciseSessionTitle('  \n\t  ')).toBeNull();
	});

	it('stops before a word that opens a parenthesis or bracket', () => {
		expect(
			conciseSessionTitle(
				'Review the uncommitted change here (git diff shows it) as a senior engineer',
			),
		).toBe('Review the uncommitted change here');
		expect(conciseSessionTitle('Fix [PROJ-123] the login flow')).toBe('Fix');
		expect(conciseSessionTitle('Update dependencies (pnpm update -r)')).toBe('Update dependencies');
	});

	it('names a chat after its words, never the chips in its prompt', () => {
		expect(
			conciseSessionTitle(
				'[[attachment:att-afc38a4412afa1900c9ea89649b1d9d3]] Carry on from [[context:src/a.ts]] here',
			),
		).toBe('Carry on from here');
		expect(conciseSessionTitle('[[attachment:att-afc38a4412afa1900c9ea89649b1d9d3]]')).toBeNull();
	});
});

describe('sessions', () => {
	it('names are distinct, Chat N stands in for a missing title, and a user run marks the first prompt', () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db, 'workstream-names');
		insertSession(db, session('session-one', 'workstream-names'));
		insertSession(db, session('session-two', 'workstream-names'));
		insertSession(db, session('session-three', 'workstream-names'));
		expect(getSession(db, 'session-one')?.displayName).toBe('New chat');
		expect(getSession(db, 'session-two')?.displayName).toBe('New chat 2');

		expect(nameSession(db, 'session-one', 'workstream-names', 'Login flow')).toBe('Login flow');
		expect(nameSession(db, 'session-two', 'workstream-names', 'Login flow')).toBe('Login flow 2');
		expect(nameSession(db, 'session-three', 'workstream-names', null)).toBe('Chat 3');
		expect(sessionHasUserRun(db, 'session-one')).toBe(false);

		insertRun(db, {
			id: 'run-one',
			sessionId: 'session-one',
			prompt: 'Please fix the login flow',
			startedAt: '2026-07-10T00:00:00Z',
			completedAt: null,
			summary: null,
			error: null,
		});
		expect(sessionHasUserRun(db, 'session-one')).toBe(true);
		db.close();
	});

	it('numbers a name only against the chats still open, never the closed ones', () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db, 'workstream-closed');
		insertSession(db, session('session-closed', 'workstream-closed'));
		archiveSession(db, 'session-closed', '2026-07-10T00:01:00Z');
		insertSession(db, session('session-open', 'workstream-closed'));
		insertSession(db, session('session-next', 'workstream-closed'));

		expect(getSession(db, 'session-open')?.displayName).toBe('New chat');
		expect(getSession(db, 'session-next')?.displayName).toBe('New chat 2');
		db.close();
	});

	it('backfills empty display names from the first prompt, New chat before one, or Chat N', () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db, 'workstream-backfill');
		insertSession(db, session('session-prompted', 'workstream-backfill'));
		insertSession(db, session('session-empty', 'workstream-backfill'));
		insertSession(db, session('session-untitled', 'workstream-backfill'));
		insertRun(db, {
			id: 'run-untitled',
			sessionId: 'session-untitled',
			prompt: '   ',
			startedAt: '2026-07-10T00:00:01Z',
			completedAt: null,
			summary: null,
			error: null,
		});
		insertRun(db, {
			id: 'run-prompted',
			sessionId: 'session-prompted',
			prompt: 'Could you rename the settings page',
			startedAt: '2026-07-10T00:00:00Z',
			completedAt: null,
			summary: null,
			error: null,
		});
		run(
			db,
			"UPDATE agent_sessions SET display_name = '' WHERE workstream_id = 'workstream-backfill'",
		);
		ensureSessionDisplayNames(db, 'workstream-backfill');
		expect(getSession(db, 'session-prompted')?.displayName).toBe('Rename the settings page');
		expect(getSession(db, 'session-empty')?.displayName).toBe('New chat');
		expect(getSession(db, 'session-untitled')?.displayName).toBe('Chat 3');
		db.close();
	});

	it('names a chat from the first prompt the user wrote, never one malini wrote', () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db, 'workstream-automated');
		insertSession(db, session('session-automated', 'workstream-automated'));
		const prompt = (id: string, text: string, automated: boolean): void =>
			insertRun(db, {
				id,
				sessionId: 'session-automated',
				prompt: text,
				startedAt: '2026-07-10T00:00:00Z',
				completedAt: null,
				summary: null,
				error: null,
				automated,
			});
		prompt('run-fix', 'Fix the current pull request from inside this workstream.', true);
		expect(sessionHasUserRun(db, 'session-automated')).toBe(false);

		prompt('run-user', 'Rename the tabs', false);
		run(db, "UPDATE agent_sessions SET display_name = '' WHERE id = 'session-automated'");
		ensureSessionDisplayNames(db, 'workstream-automated');
		expect(getSession(db, 'session-automated')?.displayName).toBe('Rename the tabs');
		expect(sessionHasUserRun(db, 'session-automated')).toBe(true);
		db.close();
	});

	it('archives idle sessions once, refuses live ones, and revokes their session rules', () => {
		const db = openMigratedDatabase(':memory:');
		seedInteractionContext(db, 'workstream-archive', 'session-live', 'run-live');
		expect(() => archiveSession(db, 'session-live', '2026-07-22T00:00:05Z')).toThrow(
			'db invariant failed: cannot archive agent session `session-live` while a run is active',
		);
		expect(() => archiveSession(db, 'session-missing', '2026-07-22T00:00:05Z')).toThrow(
			'agent session `session-missing` was not found',
		);
		run(db, "UPDATE agent_runs SET completed_at = '2026-07-22T00:00:04Z' WHERE id = 'run-live'");
		run(
			db,
			`INSERT INTO agent_permission_rules (id, scope, workstream_id, session_id, permission_fingerprint, permission_json, created_run_id, created_request_id, created_at)
			 VALUES ('rule-session', 'session', 'workstream-archive', 'session-live', ?, '{}', 'run-live', 'req', '2026-07-22T00:00:03Z')`,
			'1'.repeat(64),
		);
		archiveSession(db, 'session-live', '2026-07-22T00:00:05Z');
		archiveSession(db, 'session-live', '2026-07-22T00:00:06Z');
		expect(getSession(db, 'session-live')?.archivedAt).toBe('2026-07-22T00:00:05Z');
		expect(listPermissionRules(db, 'workstream-archive', null)[0]?.revokedAt).toBe(
			'2026-07-22T00:00:05Z',
		);
		expect(() =>
			insertRun(db, {
				id: 'run-after-archive',
				sessionId: 'session-live',
				prompt: 'no',
				startedAt: '2026-07-22T00:00:07Z',
				completedAt: null,
				summary: null,
				error: null,
			}),
		).toThrow(
			'cannot start run `run-after-archive` for missing or archived agent session `session-live`',
		);
		db.close();
	});

	it('projects the sidebar status from the latest run and repairs stale busy sessions', () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db, 'workstream-list');
		insertSession(db, session('session-idle', 'workstream-list'));
		insertSession(db, session('session-failed', 'workstream-list'));
		insertSession(db, session('session-running', 'workstream-list', { status: 'running' }));
		insertSession(db, session('session-stale', 'workstream-list', { status: 'running' }));
		insertSession(db, session('session-archived', 'workstream-list'));
		archiveSession(db, 'session-archived', '2026-07-10T00:00:01Z');
		insertRun(db, {
			id: 'run-failed',
			sessionId: 'session-failed',
			prompt: 'p',
			startedAt: '2026-07-10T00:00:00Z',
			completedAt: '2026-07-10T00:00:01Z',
			summary: null,
			error: 'boom',
		});
		insertRun(db, {
			id: 'run-open',
			sessionId: 'session-running',
			prompt: 'p',
			startedAt: '2026-07-10T00:00:00Z',
			completedAt: null,
			summary: null,
			error: null,
		});
		expect(repairSessionStatusesWithoutOpenRuns(db, 'workstream-list')).toBe(1);
		expect(getSession(db, 'session-stale')?.status).toBe('idle');
		expect(getSession(db, 'session-running')?.status).toBe('running');

		const summaries = listSessionSummaries(db, 'workstream-list');
		expect(summaries.map((row) => [row.id, row.status, row.displayName])).toEqual([
			['session-stale', 'idle', 'New chat 4'],
			['session-running', 'running', 'New chat 3'],
			['session-failed', 'failed', 'New chat 2'],
			['session-idle', 'idle', 'New chat'],
		]);
		expect(summaries[0]).toEqual({
			id: 'session-stale',
			workstreamId: 'workstream-list',
			displayName: 'New chat 4',
			model: 'anthropic/claude-sonnet-4-6',
			status: 'idle',
			startedAt: '2026-07-10T00:00:00Z',
		});
		expect(latestSessionForWorkstream(db, 'workstream-list')?.id).toBe('session-stale');
		db.close();
	});

	it('exposes identity, scope membership and the provider/model setters', () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db, 'workstream-meta');
		insertSession(db, session('session-meta', 'workstream-meta'));
		expect(agentSessionBelongsToWorkstream(db, 'workstream-meta', 'session-meta')).toBe(true);
		expect(agentSessionBelongsToWorkstream(db, 'workstream-other', 'session-meta')).toBe(false);
		expect(sessionContextIdentity(db, 'session-meta')).toEqual({
			workstreamId: 'workstream-meta',
			displayName: 'New chat',
		});
		expect(sessionContextIdentity(db, 'nope')).toBeNull();
		setProviderSessionId(db, 'session-meta', 'resume-token');
		setSessionModel(db, 'session-meta', 'openai/gpt-5.5');
		setSessionStatus(db, 'session-meta', 'completed');
		expect(getSession(db, 'session-meta')).toMatchObject({
			providerSessionId: 'resume-token',
			model: 'openai/gpt-5.5',
			status: 'completed',
		});
		db.close();
	});

	it('discarding a session takes its events, runs and session-scoped rules with it', () => {
		const db = openMigratedDatabase(':memory:');
		seedInteractionContext(db, 'workstream-discard', 'session-discard', 'run-discard');
		run(db, "UPDATE agent_runs SET completed_at = '2026-07-22T00:00:04Z' WHERE id = 'run-discard'");
		discardUnregisteredSession(db, 'session-discard');
		expect(getSession(db, 'session-discard')).toBeNull();
		expect(scalar(db, 'SELECT COUNT(*) FROM agent_runs')).toBe(0);
		expect(all(db, 'SELECT * FROM agent_events')).toEqual([]);
		db.close();
	});
});
