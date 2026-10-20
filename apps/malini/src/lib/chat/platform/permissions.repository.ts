import type { MaliniDatabase } from '$main/db/driver';
import { all, get, run, scalar } from '$main/db/rows';
import { invariant } from '$main/errors';

export type PermissionRuleScope = 'session' | 'workstream';

export interface AgentPermissionRule {
	readonly id: string;
	readonly scope: PermissionRuleScope;
	readonly workstreamId: string;
	readonly sessionId: string | null;
	readonly permissionFingerprint: string;
	readonly permissionJson: string;
	readonly createdRunId: string | null;
	readonly createdRequestId: string;
	readonly createdAt: string;
	readonly lastUsedAt: string | null;
	readonly revokedAt: string | null;
}

export interface RememberPermissionRule {
	id: string;
	scope: PermissionRuleScope;
	permissionFingerprint: string;
	permission: unknown;
}

export interface NewPermissionRule {
	readonly id: string;
	readonly scope: PermissionRuleScope;
	readonly workstreamId: string;
	readonly sessionId: string;
	readonly permissionFingerprint: string;
	readonly permissionJson: string;
	readonly createdRunId: string | null;
	readonly createdRequestId: string;
	readonly createdAt: string;
}

interface PermissionRuleRow {
	id: string;
	scope: string;
	workstream_id: string;
	session_id: string | null;
	permission_fingerprint: string;
	permission_json: string;
	created_run_id: string | null;
	created_request_id: string;
	created_at: string;
	last_used_at: string | null;
	revoked_at: string | null;
}

const RULE_COLUMNS = `id, scope, workstream_id, session_id, permission_fingerprint, permission_json,
	created_run_id, created_request_id, created_at, last_used_at, revoked_at`;

function ruleFromRow(row: PermissionRuleRow): AgentPermissionRule {
	return {
		id: row.id,
		scope: row.scope === 'session' ? 'session' : 'workstream',
		workstreamId: row.workstream_id,
		sessionId: row.session_id,
		permissionFingerprint: row.permission_fingerprint,
		permissionJson: row.permission_json,
		createdRunId: row.created_run_id,
		createdRequestId: row.created_request_id,
		createdAt: row.created_at,
		lastUsedAt: row.last_used_at,
		revokedAt: row.revoked_at,
	};
}

export function findActivePermissionRule(
	db: MaliniDatabase,
	workstreamId: string,
	sessionId: string,
	fingerprint: string,
	requiredScope: PermissionRuleScope | null = null,
): AgentPermissionRule | null {
	const row = get<PermissionRuleRow>(
		db,
		`SELECT ${RULE_COLUMNS}
		 FROM agent_permission_rules WHERE workstream_id = ?
		   AND permission_fingerprint = ? AND revoked_at IS NULL
		   AND (scope = 'workstream' OR (scope = 'session' AND session_id = ?))
		   AND (? IS NULL OR scope = ?)
		 ORDER BY CASE scope WHEN 'session' THEN 0 ELSE 1 END, created_at DESC LIMIT 1`,
		workstreamId,
		fingerprint,
		sessionId,
		requiredScope,
		requiredScope,
	);
	return row ? ruleFromRow(row) : null;
}

export function matchPermissionRule(
	db: MaliniDatabase,
	workstreamId: string,
	sessionId: string,
	fingerprint: string,
): AgentPermissionRule | null {
	return findActivePermissionRule(db, workstreamId, sessionId, fingerprint, null);
}

export function listPermissionRules(
	db: MaliniDatabase,
	workstreamId: string,
	sessionId: string | null = null,
): AgentPermissionRule[] {
	if (sessionId !== null) {
		const belongs = scalar(
			db,
			'SELECT COUNT(*) FROM agent_sessions WHERE id = ? AND workstream_id = ?',
			sessionId,
			workstreamId,
		);
		if (belongs !== 1) {
			throw invariant(`session \`${sessionId}\` does not belong to workstream \`${workstreamId}\``);
		}
	}
	return all<PermissionRuleRow>(
		db,
		`SELECT ${RULE_COLUMNS}
		 FROM agent_permission_rules WHERE workstream_id = ?
		   AND (? IS NULL OR scope = 'workstream' OR session_id = ?)
		 ORDER BY revoked_at IS NOT NULL, created_at DESC, id DESC`,
		workstreamId,
		sessionId,
		sessionId,
	).map(ruleFromRow);
}

export function revokePermissionRule(
	db: MaliniDatabase,
	workstreamId: string,
	ruleId: string,
	revokedAt: string,
): void {
	const exists = scalar(
		db,
		'SELECT COUNT(*) FROM agent_permission_rules WHERE id = ? AND workstream_id = ?',
		ruleId,
		workstreamId,
	);
	if (exists !== 1) {
		throw invariant(
			`permission rule \`${ruleId}\` was not found in workstream \`${workstreamId}\``,
		);
	}
	run(
		db,
		`UPDATE agent_permission_rules SET revoked_at = COALESCE(revoked_at, ?)
		 WHERE id = ? AND workstream_id = ?`,
		revokedAt,
		ruleId,
		workstreamId,
	);
}

export function rememberPermissionRule(db: MaliniDatabase, rule: NewPermissionRule): string {
	const existing = findActivePermissionRule(
		db,
		rule.workstreamId,
		rule.sessionId,
		rule.permissionFingerprint,
		rule.scope,
	);
	if (existing) return existing.id;
	run(
		db,
		`INSERT INTO agent_permission_rules
		 (id, scope, workstream_id, session_id, permission_fingerprint, permission_json,
		  created_run_id, created_request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		rule.id,
		rule.scope,
		rule.workstreamId,
		rule.scope === 'session' ? rule.sessionId : null,
		rule.permissionFingerprint,
		rule.permissionJson,
		rule.createdRunId,
		rule.createdRequestId,
		rule.createdAt,
	);
	return rule.id;
}

export function markPermissionRuleUsed(
	db: MaliniDatabase,
	input: {
		readonly ruleId: string;
		readonly workstreamId: string;
		readonly sessionId: string;
		readonly permissionFingerprint: string;
		readonly usedAt: string;
	},
): boolean {
	const result = run(
		db,
		`UPDATE agent_permission_rules SET last_used_at = ?
		 WHERE id = ? AND workstream_id = ? AND permission_fingerprint = ?
		   AND (scope = 'workstream' OR (scope = 'session' AND session_id = ?))`,
		input.usedAt,
		input.ruleId,
		input.workstreamId,
		input.permissionFingerprint,
		input.sessionId,
	);
	return result.changes === 1;
}
