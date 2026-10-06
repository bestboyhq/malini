import { describe, expect, it } from 'vitest';
import { openMigratedDatabase } from '$main/db/open';
import { canonicalJson } from '$main/db/rows';
import {
	abortInteractionDispatch,
	finalizeInteractionResponse,
	getInteraction,
	prepareInteractionResponse,
	recordPendingInteraction,
	type InteractionKind,
} from './interactions.repository';
import { migrate } from '$main/db/migrations';
import { ladderDatabase } from '$main/db/test-fixtures';
import {
	listPermissionRules,
	matchPermissionRule,
	revokePermissionRule,
} from './permissions.repository';
import { all, run, scalar } from '$main/db/rows';
import { discardUnregisteredSession, getSession } from './sessions.repository';
import { seedInteractionContext } from './test-support';
import { deleteWorkstream } from '$shared/repositories/repositories.platform';

const permission = {
	capability: 'read',
	resources: [
		{ kind: 'path', value: '/tmp/external', canonicalValue: '/tmp/external', boundary: 'external' },
	],
};

function rememberViaApproval(
	db: ReturnType<typeof openMigratedDatabase>,
	sessionId: string,
	runId: string,
	requestId: string,
	scope: 'session' | 'workstream',
	fingerprint: string,
	ruleId: string,
): void {
	const descriptor = {
		capability: 'read',
		resources: [
			{
				kind: 'path',
				value: `/tmp/${requestId}`,
				canonicalValue: `/tmp/${requestId}`,
				boundary: 'external',
			},
		],
	};
	expect(
		recordPendingInteraction(db, {
			kind: 'approval',
			sessionId,
			runId,
			requestId,
			requestPayload: { approvalId: requestId, reason: 'test approval', permission: descriptor },
			permission: descriptor,
			permissionFingerprint: fingerprint,
			requestedAt: '2026-07-22T00:00:02Z',
		}),
	).toBe('pending');
	const response = { decision: 'allow', scope, permission: descriptor };
	expect(
		prepareInteractionResponse(db, {
			kind: 'approval',
			sessionId,
			runId,
			requestId,
			suppliedPermission: descriptor,
			intendedResponse: response,
		}),
	).toBe('dispatch');
	expect(
		finalizeInteractionResponse(db, {
			kind: 'approval',
			sessionId,
			runId,
			requestId,
			intendedResponse: response,
			decision: 'allow',
			scope,
			source: 'manual',
			decidedAt: '2026-07-22T00:00:03Z',
			remember: { id: ruleId, scope, permissionFingerprint: fingerprint, permission: descriptor },
		}),
	).toBe(ruleId);
}

describe('interactions', () => {
	it('correlation is tuple-scoped, exact and idempotent', () => {
		const db = openMigratedDatabase(':memory:');
		seedInteractionContext(db, 'workstream-a', 'session-a', 'run-a');
		seedInteractionContext(db, 'workstream-b', 'session-b', 'run-b');
		const fingerprint = 'a'.repeat(64);
		for (const [sessionId, runId] of [
			['session-a', 'run-a'],
			['session-b', 'run-b'],
		] as const) {
			expect(
				recordPendingInteraction(db, {
					kind: 'approval',
					sessionId,
					runId,
					requestId: 'approval-1',
					requestPayload: { approvalId: 'approval-1', reason: `request for ${runId}`, permission },
					permission,
					permissionFingerprint: fingerprint,
					requestedAt: '2026-07-22T00:00:02Z',
				}),
			).toBe('pending');
		}
		expect(
			recordPendingInteraction(db, {
				kind: 'approval',
				sessionId: 'session-a',
				runId: 'run-a',
				requestId: 'approval-1',
				requestPayload: { permission, reason: 'request for run-a', approvalId: 'approval-1' },
				permission,
				permissionFingerprint: fingerprint,
				requestedAt: '2026-07-22T00:00:09Z',
			}),
		).toBe('pending');
		expect(() =>
			recordPendingInteraction(db, {
				kind: 'approval',
				sessionId: 'session-a',
				runId: 'run-a',
				requestId: 'approval-1',
				requestPayload: { approvalId: 'approval-1', reason: 'changed' },
				permission,
				permissionFingerprint: fingerprint,
				requestedAt: '2026-07-22T00:00:02Z',
			}),
		).toThrow('interaction request `approval-1` payload changed after correlation');

		const allowOnce = { decision: 'allow', scope: 'once', permission };
		const prepare = (sessionId: string, runId: string, supplied: unknown, intended: unknown) =>
			prepareInteractionResponse(db, {
				kind: 'approval',
				sessionId,
				runId,
				requestId: 'approval-1',
				suppliedPermission: supplied,
				intendedResponse: intended,
			});
		expect(() => prepare('session-a', 'run-b', permission, allowOnce)).toThrow(
			'pending approval request `approval-1` was not found for session `session-a` run `run-b`',
		);
		expect(() => prepare('session-a', 'run-a', { tampered: true }, allowOnce)).toThrow(
			'permission payload for `approval-1` does not match the pending request',
		);
		expect(prepare('session-a', 'run-a', permission, allowOnce)).toBe('dispatch');
		expect(getInteraction(db, 'approval', 'session-a', 'run-a', 'approval-1')).toMatchObject({
			state: 'dispatching',
			intendedResponse: allowOnce,
		});
		expect(() => prepare('session-a', 'run-a', permission, allowOnce)).toThrow(
			'interaction `approval-1` cannot be decided: same response is already awaiting acknowledgement',
		);
		abortInteractionDispatch(db, 'approval', 'session-a', 'run-a', 'approval-1', allowOnce);
		expect(getInteraction(db, 'approval', 'session-a', 'run-a', 'approval-1')?.state).toBe(
			'pending',
		);
		expect(prepare('session-a', 'run-a', permission, allowOnce)).toBe('dispatch');

		expect(
			finalizeInteractionResponse(db, {
				kind: 'approval',
				sessionId: 'session-a',
				runId: 'run-a',
				requestId: 'approval-1',
				intendedResponse: allowOnce,
				decision: 'allow',
				scope: 'once',
				source: 'manual',
				decidedAt: '2026-07-22T00:00:03Z',
			}),
		).toBeNull();
		expect(getInteraction(db, 'approval', 'session-a', 'run-a', 'approval-1')).toMatchObject({
			state: 'resolved',
			response: allowOnce,
			decision: 'allow',
			scope: 'once',
			source: 'manual',
		});
		expect(getSession(db, 'session-a')?.status).toBe('running');
		expect(prepare('session-a', 'run-a', permission, allowOnce)).toBe('already_resolved');
		expect(() =>
			prepare('session-a', 'run-a', permission, { decision: 'deny', scope: 'once', permission }),
		).toThrow('interaction `approval-1` was already resolved with a different response');

		run(db, "UPDATE agent_runs SET completed_at = '2026-07-22T00:00:04Z' WHERE id = 'run-b'");
		expect(() => prepare('session-b', 'run-b', permission, allowOnce)).toThrow(
			'interaction `approval-1` belongs to a stale run',
		);
		db.close();
	});

	it('validates the request before touching the database', () => {
		const db = openMigratedDatabase(':memory:');
		seedInteractionContext(db, 'workstream-v', 'session-v', 'run-v');
		const base = {
			sessionId: 'session-v',
			runId: 'run-v',
			requestId: 'q-1',
			requestedAt: '2026-07-22T00:00:02Z',
		};
		expect(() =>
			recordPendingInteraction(db, { ...base, kind: 'question', requestPayload: {}, permission }),
		).toThrow('question interactions cannot carry permissions');
		expect(() =>
			recordPendingInteraction(db, {
				...base,
				kind: 'approval',
				requestPayload: {},
				permissionFingerprint: 'a'.repeat(64),
			}),
		).toThrow('interaction permission fingerprint has no descriptor');
		expect(() =>
			recordPendingInteraction(db, {
				...base,
				kind: 'approval',
				requestPayload: {},
				permission,
				permissionFingerprint: 'A'.repeat(64),
			}),
		).toThrow('interaction permission fingerprint is invalid');
		expect(() =>
			recordPendingInteraction(db, {
				...base,
				kind: 'approval',
				requestPayload: {},
				requestedAt: '',
			}),
		).toThrow('interaction request timestamp is invalid');
		expect(() =>
			recordPendingInteraction(db, {
				...base,
				kind: 'approval',
				requestPayload: { big: 'x'.repeat(256 * 1024) },
			}),
		).toThrow('interaction request payload exceeds 256 KiB');
		expect(() =>
			recordPendingInteraction(db, {
				...base,
				kind: 'approval',
				requestPayload: {},
				requestId: 'bad\nid',
			}),
		).toThrow('interaction request id is empty or invalid');
		const unsupportedKind: InteractionKind = JSON.parse('"nope"');
		expect(() =>
			recordPendingInteraction(db, { ...base, kind: unsupportedKind, requestPayload: {} }),
		).toThrow('unsupported interaction kind `nope`');
		expect(() =>
			recordPendingInteraction(db, {
				...base,
				kind: 'question',
				runId: 'run-other',
				requestPayload: {},
			}),
		).toThrow('interaction `q-1` does not belong to session `session-v` run `run-other`');
		db.close();
	});

	it('a question resolves as answered with no scope, and an auto decision touches its rule', () => {
		const db = openMigratedDatabase(':memory:');
		seedInteractionContext(db, 'workstream-q', 'session-q', 'run-q');
		recordPendingInteraction(db, {
			kind: 'question',
			sessionId: 'session-q',
			runId: 'run-q',
			requestId: 'question-1',
			requestPayload: { questionId: 'question-1', prompt: 'Which?' },
			requestedAt: '2026-07-22T00:00:02Z',
		});
		const answer = { answers: [{ questionId: 'question-1', values: ['a'] }] };
		prepareInteractionResponse(db, {
			kind: 'question',
			sessionId: 'session-q',
			runId: 'run-q',
			requestId: 'question-1',
			suppliedPermission: null,
			intendedResponse: answer,
		});
		expect(() =>
			finalizeInteractionResponse(db, {
				kind: 'question',
				sessionId: 'session-q',
				runId: 'run-q',
				requestId: 'question-1',
				intendedResponse: answer,
				decision: 'allow',
				scope: null,
				source: 'manual',
				decidedAt: '2026-07-22T00:00:03Z',
			}),
		).toThrow('invalid interaction resolution shape');
		expect(
			finalizeInteractionResponse(db, {
				kind: 'question',
				sessionId: 'session-q',
				runId: 'run-q',
				requestId: 'question-1',
				intendedResponse: answer,
				decision: 'answered',
				scope: null,
				source: 'manual',
				decidedAt: '2026-07-22T00:00:03Z',
			}),
		).toBeNull();

		const fingerprint = '5'.repeat(64);
		rememberViaApproval(
			db,
			'session-q',
			'run-q',
			'approval-first',
			'workstream',
			fingerprint,
			'rule-w',
		);
		const descriptor = {
			capability: 'read',
			resources: [
				{
					kind: 'path',
					value: '/tmp/approval-first',
					canonicalValue: '/tmp/approval-first',
					boundary: 'external',
				},
			],
		};
		recordPendingInteraction(db, {
			kind: 'approval',
			sessionId: 'session-q',
			runId: 'run-q',
			requestId: 'approval-auto',
			requestPayload: { approvalId: 'approval-auto', permission: descriptor },
			permission: descriptor,
			permissionFingerprint: fingerprint,
			requestedAt: '2026-07-22T00:00:04Z',
		});
		const auto = { decision: 'allow', scope: 'workstream', permission: descriptor };
		prepareInteractionResponse(db, {
			kind: 'approval',
			sessionId: 'session-q',
			runId: 'run-q',
			requestId: 'approval-auto',
			suppliedPermission: descriptor,
			intendedResponse: auto,
		});
		expect(
			finalizeInteractionResponse(db, {
				kind: 'approval',
				sessionId: 'session-q',
				runId: 'run-q',
				requestId: 'approval-auto',
				intendedResponse: auto,
				decision: 'allow',
				scope: 'workstream',
				source: 'auto',
				decidedAt: '2026-07-22T00:00:05Z',
				matchedRuleId: 'rule-w',
			}),
		).toBe('rule-w');
		expect(listPermissionRules(db, 'workstream-q', 'session-q')[0]).toMatchObject({
			id: 'rule-w',
			lastUsedAt: '2026-07-22T00:00:05Z',
			permissionJson: canonicalJson(descriptor),
		});
		expect(() => listPermissionRules(db, 'workstream-q', 'session-foreign')).toThrow(
			'session `session-foreign` does not belong to workstream `workstream-q`',
		);
		db.close();
	});

	it('v17 upgrade closes only terminal-run interactions and preserves the audit payload', () => {
		const db = ladderDatabase(16);
		db.exec(`
			INSERT INTO projects (id, name, repo_path, default_branch, created_at) VALUES
			  ('project-closed', 'closed', '/tmp/closed', 'main', '2026-07-22T00:00:00Z'),
			  ('project-open', 'open', '/tmp/open', 'main', '2026-07-22T00:00:00Z');
			INSERT INTO workspaces (id, project_id, name, path, branch, base_branch, status, created_at) VALUES
			  ('workstream-closed', 'project-closed', 'closed', '/tmp/closed/ws', 'malini/closed', 'main', 'active', '2026-07-22T00:00:00Z'),
			  ('workstream-open', 'project-open', 'open', '/tmp/open/ws', 'malini/open', 'main', 'active', '2026-07-22T00:00:00Z');
			INSERT INTO agent_sessions (id, workspace_id, provider, model, status, started_at) VALUES
			  ('session-closed', 'workstream-closed', 'core', NULL, 'waiting_for_approval', '2026-07-22T00:00:00Z'),
			  ('session-open', 'workstream-open', 'core', NULL, 'waiting_for_approval', '2026-07-22T00:00:00Z');
			INSERT INTO agent_runs (id, session_id, prompt, started_at, completed_at, error) VALUES
			  ('run-closed', 'session-closed', 'Read external context', '2026-07-22T00:00:01Z', '2026-07-23T08:08:47.979Z', 'cancelled'),
			  ('run-open', 'session-open', 'Read external context', '2026-07-22T00:00:01Z', NULL, NULL);
			INSERT INTO agent_interactions (kind, session_id, workspace_id, run_id, request_id, request_payload_json, state, requested_at) VALUES
			  ('approval', 'session-closed', 'workstream-closed', 'run-closed', 'approval-closed', '{"approvalId":"approval-closed","reason":"Confirm"}', 'pending', '2026-07-23T08:08:18.127Z'),
			  ('approval', 'session-open', 'workstream-open', 'run-open', 'approval-open', '{"approvalId":"approval-open","reason":"Confirm"}', 'pending', '2026-07-23T08:08:18.127Z');
		`);
		migrate(db);
		const closed = all<{ state: string; closed_at: string | null; request_payload_json: string }>(
			db,
			"SELECT state, closed_at, request_payload_json FROM agent_interactions WHERE session_id = 'session-closed'",
		)[0];
		expect(closed?.state).toBe('closed');
		expect(closed?.closed_at).toBe('2026-07-23T08:08:47.979Z');
		expect(closed?.request_payload_json).toContain('approval-closed');
		expect(getInteraction(db, 'approval', 'session-open', 'run-open', 'approval-open')?.state).toBe(
			'pending',
		);
		expect(() =>
			prepareInteractionResponse(db, {
				kind: 'approval',
				sessionId: 'session-closed',
				runId: 'run-closed',
				requestId: 'approval-closed',
				suppliedPermission: null,
				intendedResponse: {},
			}),
		).toThrow('interaction `approval-closed` belongs to a terminal run');
		db.close();
	});

	it('permission rule scope controls origin-chat and workstream cleanup', () => {
		const db = openMigratedDatabase(':memory:');
		seedInteractionContext(db, 'workstream-rules', 'session-origin', 'run-origin');
		rememberViaApproval(
			db,
			'session-origin',
			'run-origin',
			'approval-session',
			'session',
			'1'.repeat(64),
			'rule-session',
		);
		rememberViaApproval(
			db,
			'session-origin',
			'run-origin',
			'approval-workstream-a',
			'workstream',
			'2'.repeat(64),
			'rule-workstream-a',
		);
		rememberViaApproval(
			db,
			'session-origin',
			'run-origin',
			'approval-workstream-b',
			'workstream',
			'3'.repeat(64),
			'rule-workstream-b',
		);
		expect(matchPermissionRule(db, 'workstream-rules', 'session-origin', '1'.repeat(64))?.id).toBe(
			'rule-session',
		);
		expect(matchPermissionRule(db, 'workstream-rules', 'other-chat', '1'.repeat(64))).toBeNull();
		run(db, "UPDATE agent_runs SET completed_at = '2026-07-22T00:00:04Z' WHERE id = 'run-origin'");

		discardUnregisteredSession(db, 'session-origin');
		const remaining = listPermissionRules(db, 'workstream-rules', null);
		expect(remaining).toHaveLength(2);
		expect(
			remaining.every(
				(rule) =>
					rule.scope === 'workstream' && rule.sessionId === null && rule.createdRunId === null,
			),
		).toBe(true);
		expect(
			matchPermissionRule(db, 'workstream-rules', 'future-chat', '2'.repeat(64)),
		).not.toBeNull();

		revokePermissionRule(db, 'workstream-rules', 'rule-workstream-a', '2026-07-22T00:00:05Z');
		expect(() =>
			revokePermissionRule(db, 'workstream-rules', 'rule-missing', '2026-07-22T00:00:05Z'),
		).toThrow('permission rule `rule-missing` was not found in workstream `workstream-rules`');
		expect(matchPermissionRule(db, 'workstream-rules', 'future-chat', '2'.repeat(64))).toBeNull();
		expect(
			matchPermissionRule(db, 'workstream-rules', 'future-chat', '3'.repeat(64)),
		).not.toBeNull();
		expect(listPermissionRules(db, 'workstream-rules', null).map((rule) => rule.id)).toEqual([
			'rule-workstream-b',
			'rule-workstream-a',
		]);

		deleteWorkstream(db, 'workstream-rules');
		expect(scalar(db, 'SELECT COUNT(*) FROM agent_permission_rules')).toBe(0);
		db.close();
	});
});
