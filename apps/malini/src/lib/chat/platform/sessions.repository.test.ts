import { describe, expect, it } from 'vitest';
import type { AgentRunProfile } from '$contract/agent';
import {
	foldSessionStatus,
	PAUSED_FOR_EXIT_ERROR,
	type SessionStatus,
} from '$contract/agent-state-machine';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { listPermissionRules } from './permissions.repository';
import { all, isRecord, run, scalar } from '$main/db/rows';
import { handleSendPromptHandoffFailure } from './agent/commands';
import { terminalizeRunsAfterBridgeLoss } from './agent/lifecycle';
import { pumpStep, SessionCorrelator } from './agent/runtime';
import { insertCheckpoint, supersedeSessionFromCheckpoint } from './checkpoints.repository';
import { appendEvent, listEventRowsForSession } from './events.repository';
import { finalizeInteractionResponse, prepareInteractionResponse } from './interactions.repository';
import { finalizeRunLifecycle, insertRun } from './runs.repository';
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
	namedChatName,
	repairSessionStatusesWithoutOpenRuns,
	sessionContextIdentity,
	setProviderSessionId,
	moveSessionStatus,
	setSessionModel,
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
		provider: 'claude',
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
	it('names are distinct, and a chat a person started tells its name to the namer', () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db, 'workstream-names');
		insertSession(db, session('session-one', 'workstream-names'));
		insertSession(db, session('session-two', 'workstream-names'));
		insertSession(db, session('session-automation', 'workstream-names'), {
			origin: 'automation',
			displayName: 'Fix checks',
		});
		expect(getSession(db, 'session-one')?.displayName).toBe('New chat');
		expect(getSession(db, 'session-two')?.displayName).toBe('New chat 2');

		expect(nameSession(db, 'session-one', 'workstream-names', 'Login flow')).toBe('Login flow');
		expect(nameSession(db, 'session-two', 'workstream-names', 'Login flow')).toBe('Login flow 2');
		expect(namedChatName(db, 'session-one')).toBe('Login flow');
		expect(namedChatName(db, 'session-automation')).toBeNull();
		archiveSession(db, 'session-two', '2026-07-10T00:00:00Z');
		expect(namedChatName(db, 'session-two')).toBeNull();
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

		prompt('run-user', 'Rename the tabs', false);
		run(db, "UPDATE agent_sessions SET display_name = '' WHERE id = 'session-automated'");
		ensureSessionDisplayNames(db, 'workstream-automated');
		expect(getSession(db, 'session-automated')?.displayName).toBe('Rename the tabs');
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

	it('lists the stored status and repairs stale busy sessions', () => {
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
			completedAt: null,
			summary: null,
			error: null,
		});
		finalizeRunLifecycle(
			db,
			'session-failed',
			'run-failed',
			'failed',
			null,
			'boom',
			'2026-07-10T00:00:01Z',
		);
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
			provider: 'claude',
			model: 'anthropic/claude-sonnet-4-6',
			status: 'idle',
			startedAt: '2026-07-10T00:00:00Z',
			origin: 'user',
			latestProfile: null,
		});
		expect(latestSessionForWorkstream(db, 'workstream-list')?.id).toBe('session-stale');
		db.close();
	});

	it('keeps automation transcripts out of chat naming, titling and the default chat', () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db, 'workstream-automations');
		insertSession(db, session('session-chat', 'workstream-automations'));
		insertSession(db, session('session-automation', 'workstream-automations'), {
			origin: 'automation',
			displayName: 'New chat',
		});
		insertSession(db, session('session-automation-2', 'workstream-automations'), {
			origin: 'automation',
			displayName: 'New chat',
		});
		insertSession(db, session('session-unnamed-automation', 'workstream-automations'), {
			origin: 'automation',
			displayName: null,
		});
		insertSession(db, session('session-named', 'workstream-automations'), {
			origin: 'user',
			displayName: 'Release notes',
		});

		expect(getSession(db, 'session-automation')?.displayName).toBe('New chat');
		expect(getSession(db, 'session-automation-2')?.displayName).toBe('New chat');
		expect(getSession(db, 'session-unnamed-automation')?.displayName).toBe('Automation');
		expect(getSession(db, 'session-named')?.displayName).toBe('Release notes');
		expect(nameSession(db, 'session-named', 'workstream-automations', 'Automation')).toBe(
			'Automation',
		);
		expect(
			listSessionSummaries(db, 'workstream-automations').map(({ id, origin }) => [id, origin]),
		).toEqual([
			['session-named', 'user'],
			['session-unnamed-automation', 'automation'],
			['session-automation-2', 'automation'],
			['session-automation', 'automation'],
			['session-chat', 'user'],
		]);
		expect(latestSessionForWorkstream(db, 'workstream-automations')?.id).toBe('session-named');
		archiveSession(db, 'session-named', '2026-07-10T00:00:01Z');
		expect(latestSessionForWorkstream(db, 'workstream-automations')?.id).toBe('session-chat');
		db.close();
	});

	it('carries the profile of the latest kept run that recorded one', () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db, 'workstream-profile');
		insertSession(db, session('session-automation', 'workstream-profile'), {
			origin: 'automation',
			displayName: null,
		});
		const finished = (id: string, profile?: AgentRunProfile) =>
			insertRun(db, {
				id,
				sessionId: 'session-automation',
				prompt: 'p',
				startedAt: '2026-07-10T00:00:00Z',
				completedAt: '2026-07-10T00:00:01Z',
				summary: null,
				error: null,
				automated: true,
				...(profile ? { profile } : {}),
			});
		const latest = () => listSessionSummaries(db, 'workstream-profile')[0]?.latestProfile;

		expect(latest()).toBeNull();
		finished('run-automation', { effort: 'high', mode: 'agent', access: 'auto' });
		finished('run-undone', { effort: 'max', mode: 'plan', access: 'full' });
		run(db, "UPDATE agent_runs SET obsoleted_at = '2026-07-10T00:00:02Z' WHERE id = 'run-undone'");
		finished('run-without-profile');
		expect(latest()).toEqual({ effort: 'high', mode: 'agent', access: 'auto' });
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
		setSessionModel(db, 'session-meta', 'vendor/model-5');
		expect(moveSessionStatus(db, 'session-meta', 'run.completed')).toBe('completed');
		expect(moveSessionStatus(db, 'nope', 'run.started')).toBeNull();
		expect(getSession(db, 'session-meta')).toMatchObject({
			providerSessionId: 'resume-token',
			model: 'vendor/model-5',
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

describe('session status', () => {
	const WORKSTREAM = 'workstream-status';
	const SESSION = 'session-status';

	function seeded(): MaliniDatabase {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db, WORKSTREAM);
		insertSession(db, session(SESSION, WORKSTREAM));
		return db;
	}

	function started(db: MaliniDatabase, runId: string, correlator = new SessionCorrelator()) {
		insertRun(db, {
			id: runId,
			sessionId: SESSION,
			prompt: 'p',
			startedAt: '2026-07-10T00:00:00Z',
			completedAt: null,
			summary: null,
			error: null,
		});
		pumpStep(correlator, db, { type: 'run.started', runId, sessionId: SESSION });
		return correlator;
	}

	function statuses(db: MaliniDatabase) {
		return {
			stored: getSession(db, SESSION)?.status,
			listed: listSessionSummaries(db, WORKSTREAM).find(({ id }) => id === SESSION)?.status,
			folded: foldSessionStatus(
				'idle',
				listEventRowsForSession(db, SESSION, 0).map(({ runId, kind, payload }) => ({
					runId,
					event: { ...(isRecord(payload) ? payload : {}), type: kind },
				})),
			).status,
		};
	}

	function agreeOn(status: SessionStatus) {
		return { stored: status, listed: status, folded: status };
	}

	function decide(db: MaliniDatabase, runId: string, approvalId: string): void {
		const intendedResponse = { decision: 'allow', scope: 'once', permission: null };
		const request = { kind: 'approval', sessionId: SESSION, runId, requestId: approvalId } as const;
		prepareInteractionResponse(db, { ...request, suppliedPermission: null, intendedResponse });
		finalizeInteractionResponse(db, {
			...request,
			intendedResponse,
			decision: 'allow',
			scope: 'once',
			source: 'manual',
			decidedAt: '2026-07-10T00:00:02Z',
		});
		appendEvent(db, SESSION, runId, 'approval.decided', {
			approvalId,
			decision: 'allow',
			scope: 'once',
			remembered: false,
		});
	}

	it('agrees with the event fold after a stop, a pause, a bridge restart and a lost prompt', () => {
		const db = seeded();
		const correlator = started(db, 'run-stopped');
		pumpStep(correlator, db, { type: 'run.failed', runId: 'run-stopped', error: 'cancelled' });
		expect(statuses(db)).toEqual(agreeOn('idle'));

		started(db, 'run-paused', correlator);
		pumpStep(correlator, db, {
			type: 'run.failed',
			runId: 'run-paused',
			error: PAUSED_FOR_EXIT_ERROR,
		});
		expect(statuses(db)).toEqual(agreeOn('idle'));

		started(db, 'run-cut', correlator);
		terminalizeRunsAfterBridgeLoss(db, () => {});
		expect(statuses(db)).toEqual(agreeOn('idle'));

		started(db, 'run-lost', correlator);
		handleSendPromptHandoffFailure(
			db,
			SESSION,
			'run-lost',
			'agent bridge send failed: closed',
			() => {},
		);
		expect(statuses(db)).toEqual(agreeOn('failed'));
		db.close();
	});

	it('agrees with the event fold while a run waits on the user and after each answer', () => {
		const db = seeded();
		const correlator = started(db, 'run-asks');
		for (const approvalId of ['approval-1', 'approval-2']) {
			pumpStep(correlator, db, {
				type: 'approval.requested',
				sessionId: SESSION,
				runId: 'run-asks',
				approvalId,
				reason: 'read outside',
				toolName: 'read_file',
			});
		}
		expect(statuses(db)).toEqual(agreeOn('waiting_for_approval'));

		decide(db, 'run-asks', 'approval-1');
		expect(statuses(db)).toEqual(agreeOn('waiting_for_approval'));

		decide(db, 'run-asks', 'approval-2');
		expect(statuses(db)).toEqual(agreeOn('running'));

		pumpStep(correlator, db, { type: 'run.completed', runId: 'run-asks', summary: 'Done.' });
		expect(statuses(db)).toEqual(agreeOn('completed'));
		db.close();
	});

	it('agrees with the event fold once Claude Code withdraws a request nobody answered', () => {
		const db = seeded();
		const runId = 'run-withdraws';
		const correlator = started(db, runId);
		for (const approvalId of ['approval-fork', 'approval-1']) {
			pumpStep(correlator, db, {
				type: 'approval.requested',
				sessionId: SESSION,
				runId,
				approvalId,
				reason: 'read outside',
				toolName: 'read_file',
			});
		}
		const withdraw = (approvalId: string) =>
			pumpStep(correlator, db, { type: 'approval.withdrawn', runId, approvalId });

		expect(withdraw('approval-fork')).not.toBeNull();
		expect(statuses(db)).toEqual(agreeOn('waiting_for_approval'));

		decide(db, runId, 'approval-1');
		expect(statuses(db)).toEqual(agreeOn('running'));
		expect(withdraw('approval-1')).toBeNull();
		expect(withdraw('approval-fork')).toBeNull();
		expect(statuses(db)).toEqual(agreeOn('running'));
		expect(
			scalar(
				db,
				"SELECT COUNT(*) FROM agent_interactions WHERE run_id = ? AND state = 'pending'",
				runId,
			),
		).toBe(0);
		db.close();
	});

	it('agrees with the event fold when a repair or a restore rewrites a closed run', () => {
		const db = seeded();
		const correlator = started(db, 'run-limited');
		appendEvent(db, SESSION, 'run-limited', 'run.failed', {
			error: "You've hit your session limit",
			resumeAt: '2026-07-10T05:00:00Z',
		});
		finalizeRunLifecycle(
			db,
			SESSION,
			'run-limited',
			'failed',
			null,
			"You've hit your session limit",
			'2026-07-10T00:00:01Z',
			{ kind: 'usage-limit', resumeAt: '2026-07-10T05:00:00Z' },
		);
		run(db, "UPDATE agent_sessions SET status = 'running' WHERE id = ?", SESSION);
		repairSessionStatusesWithoutOpenRuns(db, WORKSTREAM);
		expect(statuses(db)).toEqual(agreeOn('idle'));

		started(db, 'run-restored', correlator);
		pumpStep(correlator, db, { type: 'run.completed', runId: 'run-restored', summary: 'Done.' });
		expect(statuses(db)).toEqual(agreeOn('completed'));
		const checkpoint = {
			id: 'checkpoint-1',
			workstreamId: WORKSTREAM,
			sessionId: SESSION,
			runId: 'run-restored',
			userMessageSeq:
				listEventRowsForSession(db, SESSION, 0).find(({ runId }) => runId === 'run-restored')
					?.seq ?? null,
			gitRef: 'refs/malini/checkpoints/1',
			gitCommit: 'abc',
			createdAt: '2026-07-10T00:00:03Z',
		};
		insertCheckpoint(db, checkpoint);
		supersedeSessionFromCheckpoint(db, checkpoint, null, () => {});
		expect(statuses(db)).toEqual(agreeOn('idle'));
		db.close();
	});
});
