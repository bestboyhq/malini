import type { MaliniDatabase } from '$main/db/driver';
import { findActivePermissionRule, type RememberPermissionRule } from './permissions.repository';
import { invariant } from '$main/errors';
import { canonicalJson, get, jsonEqual, parseJsonColumn, run, scalar } from '$main/db/rows';

export type InteractionKind = 'approval' | 'question';
export type InteractionState = 'pending' | 'dispatching' | 'resolved' | 'closed';
export type InteractionDecision = 'allow' | 'deny' | 'answered';
export type InteractionScope = 'once' | 'session' | 'workstream';
export type InteractionSource = 'manual' | 'auto';

export type InteractionRecordOutcome = InteractionState;

export type InteractionPrepareOutcome = 'dispatch' | 'already_resolved';

export interface AgentInteractionRecord {
	kind: InteractionKind;
	sessionId: string;
	workstreamId: string;
	runId: string;
	requestId: string;
	requestPayload: unknown;
	permission: unknown | null;
	permissionFingerprint: string | null;
	state: InteractionState;
	intendedResponse: unknown | null;
	response: unknown | null;
	decision: InteractionDecision | null;
	scope: InteractionScope | null;
	source: InteractionSource | null;
	closedAt: string | null;
}

interface InteractionRow {
	kind: InteractionKind;
	session_id: string;
	workstream_id: string;
	run_id: string;
	request_id: string;
	request_payload_json: string;
	permission_json: string | null;
	permission_fingerprint: string | null;
	state: InteractionState;
	intended_response_json: string | null;
	response_json: string | null;
	decision: InteractionDecision | null;
	scope: InteractionScope | null;
	source: InteractionSource | null;
	closed_at: string | null;
}

const MAX_REQUEST_PAYLOAD_BYTES = 256 * 1024;
const MAX_PERMISSION_BYTES = 64 * 1024;

export function closeTerminalInteractions(
	db: MaliniDatabase,
	sessionId: string,
	runId: string,
	closedAt: string,
): number {
	return run(
		db,
		`UPDATE agent_interactions SET state = 'closed', closed_at = ?
		 WHERE session_id = ? AND run_id = ? AND state IN ('pending', 'dispatching')`,
		closedAt,
		sessionId,
		runId,
	).changes;
}

function validateInteractionIdentity(
	kind: string,
	sessionId: string,
	runId: string,
	requestId: string,
): void {
	if (kind !== 'approval' && kind !== 'question') {
		throw invariant(`unsupported interaction kind \`${kind}\``);
	}
	for (const [label, value] of [
		['session', sessionId],
		['run', runId],
		['request', requestId],
	] as const) {
		if (
			value.length === 0 ||
			Buffer.byteLength(value) > 256 ||
			value.includes('\0') ||
			value.includes('\n') ||
			value.includes('\r')
		) {
			throw invariant(`interaction ${label} id is empty or invalid`);
		}
	}
}

function jsonText(value: unknown): string | undefined {
	const text = canonicalJson(value) as string | undefined;
	return text;
}

function loadInteraction(
	db: MaliniDatabase,
	kind: string,
	sessionId: string,
	runId: string,
	requestId: string,
): AgentInteractionRecord | null {
	const row = get<InteractionRow>(
		db,
		`SELECT kind, session_id, workstream_id, run_id, request_id, request_payload_json,
		        permission_json, permission_fingerprint, state, intended_response_json,
		        response_json, decision, scope, source, closed_at
		 FROM agent_interactions WHERE kind = ? AND session_id = ?
		   AND run_id = ? AND request_id = ?`,
		kind,
		sessionId,
		runId,
		requestId,
	);
	if (!row) return null;
	return {
		kind: row.kind,
		sessionId: row.session_id,
		workstreamId: row.workstream_id,
		runId: row.run_id,
		requestId: row.request_id,
		requestPayload: parseJsonColumn(row.request_payload_json),
		permission: parseJsonColumn(row.permission_json),
		permissionFingerprint: row.permission_fingerprint,
		state: row.state,
		intendedResponse: parseJsonColumn(row.intended_response_json),
		response: parseJsonColumn(row.response_json),
		decision: row.decision,
		scope: row.scope,
		source: row.source,
		closedAt: row.closed_at,
	};
}

export interface PendingInteractionInput {
	kind: InteractionKind;
	sessionId: string;
	runId: string;
	requestId: string;
	requestPayload: unknown;
	permission?: unknown | null;
	permissionFingerprint?: string | null;
	requestedAt: string;
}

export function recordPendingInteraction(
	db: MaliniDatabase,
	input: PendingInteractionInput,
): InteractionRecordOutcome {
	const { kind, sessionId, runId, requestId, requestedAt } = input;
	const permission = input.permission ?? null;
	const permissionFingerprint = input.permissionFingerprint ?? null;
	validateInteractionIdentity(kind, sessionId, runId, requestId);
	const requestPayloadJson = jsonText(input.requestPayload);
	if (requestPayloadJson === undefined) {
		throw invariant('interaction request payload is not valid JSON');
	}
	if (Buffer.byteLength(requestPayloadJson) > MAX_REQUEST_PAYLOAD_BYTES) {
		throw invariant('interaction request payload exceeds 256 KiB');
	}
	if (requestedAt.length === 0 || Buffer.byteLength(requestedAt) > 64) {
		throw invariant('interaction request timestamp is invalid');
	}
	if (kind === 'question' && (permission !== null || permissionFingerprint !== null)) {
		throw invariant('question interactions cannot carry permissions');
	}
	let permissionJson: string | null = null;
	if (permission !== null) {
		permissionJson = jsonText(permission) ?? null;
		if (permissionJson === null || Buffer.byteLength(permissionJson) > MAX_PERMISSION_BYTES) {
			throw invariant('interaction permission payload is invalid or oversized');
		}
	}
	if (permissionFingerprint !== null && permission === null) {
		throw invariant('interaction permission fingerprint has no descriptor');
	}
	if (permissionFingerprint !== null && !/^[0-9a-f]{64}$/.test(permissionFingerprint)) {
		throw invariant('interaction permission fingerprint is invalid');
	}

	return db.transaction(() => {
		const context = get<{
			workstream_id: string;
			completed_at: string | null;
			archived_at: string | null;
		}>(
			db,
			`SELECT s.workstream_id, r.completed_at, s.archived_at
			 FROM agent_runs r JOIN agent_sessions s ON s.id = r.session_id
			 WHERE r.id = ? AND r.session_id = ?`,
			runId,
			sessionId,
		);
		if (!context) {
			throw invariant(
				`interaction \`${requestId}\` does not belong to session \`${sessionId}\` run \`${runId}\``,
			);
		}
		if (context.completed_at !== null || context.archived_at !== null) {
			throw invariant(`interaction \`${requestId}\` belongs to a stale or archived run`);
		}

		const existing = loadInteraction(db, kind, sessionId, runId, requestId);
		if (existing) {
			if (
				!jsonEqual(existing.requestPayload, input.requestPayload) ||
				!optionalJsonEqual(existing.permission, permission) ||
				existing.permissionFingerprint !== permissionFingerprint ||
				existing.workstreamId !== context.workstream_id
			) {
				throw invariant(`interaction request \`${requestId}\` payload changed after correlation`);
			}
			return existing.state;
		}

		run(
			db,
			`INSERT INTO agent_interactions
			 (kind, session_id, workstream_id, run_id, request_id, request_payload_json,
			  permission_json, permission_fingerprint, state, requested_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
			kind,
			sessionId,
			context.workstream_id,
			runId,
			requestId,
			requestPayloadJson,
			permissionJson,
			permissionFingerprint,
			requestedAt,
		);
		return 'pending';
	});
}

function optionalJsonEqual(left: unknown | null, right: unknown | null): boolean {
	if (left === null && right === null) return true;
	if (left === null || right === null) return false;
	return jsonEqual(left, right);
}

export function getInteraction(
	db: MaliniDatabase,
	kind: InteractionKind,
	sessionId: string,
	runId: string,
	requestId: string,
): AgentInteractionRecord | null {
	return loadInteraction(db, kind, sessionId, runId, requestId);
}

export interface PrepareInteractionResponseInput {
	kind: InteractionKind;
	sessionId: string;
	runId: string;
	requestId: string;
	suppliedPermission: unknown | null;
	intendedResponse: unknown;
}

export function prepareInteractionResponse(
	db: MaliniDatabase,
	input: PrepareInteractionResponseInput,
): InteractionPrepareOutcome {
	const { kind, sessionId, runId, requestId, intendedResponse } = input;
	validateInteractionIdentity(kind, sessionId, runId, requestId);
	return db.transaction(() => {
		const record = loadInteraction(db, kind, sessionId, runId, requestId);
		if (!record) {
			throw invariant(
				`pending ${kind} request \`${requestId}\` was not found for session \`${sessionId}\` run \`${runId}\``,
			);
		}
		if (!optionalJsonEqual(record.permission, input.suppliedPermission)) {
			throw invariant(`permission payload for \`${requestId}\` does not match the pending request`);
		}
		switch (record.state) {
			case 'resolved':
				if (record.response !== null && jsonEqual(record.response, intendedResponse)) {
					return 'already_resolved';
				}
				throw invariant(
					`interaction \`${requestId}\` was already resolved with a different response`,
				);
			case 'dispatching': {
				const qualifier =
					record.intendedResponse !== null && jsonEqual(record.intendedResponse, intendedResponse)
						? 'same response is already awaiting acknowledgement'
						: 'a different response is already awaiting acknowledgement';
				throw invariant(`interaction \`${requestId}\` cannot be decided: ${qualifier}`);
			}
			case 'pending':
				break;
			case 'closed':
				throw invariant(`interaction \`${requestId}\` belongs to a terminal run`);
			default:
				throw invariant(
					`interaction \`${requestId}\` has invalid state \`${String(record.state)}\``,
				);
		}
		const active = scalar(
			db,
			`SELECT COUNT(*) FROM agent_runs r JOIN agent_sessions s ON s.id = r.session_id
			 WHERE r.id = ? AND r.session_id = ? AND r.completed_at IS NULL
			   AND s.archived_at IS NULL AND s.workstream_id = ?`,
			runId,
			sessionId,
			record.workstreamId,
		);
		if (active !== 1) throw invariant(`interaction \`${requestId}\` belongs to a stale run`);
		const { changes } = run(
			db,
			`UPDATE agent_interactions SET state = 'dispatching', intended_response_json = ?
			 WHERE kind = ? AND session_id = ? AND run_id = ? AND request_id = ?
			   AND state = 'pending'`,
			canonicalJson(intendedResponse),
			kind,
			sessionId,
			runId,
			requestId,
		);
		if (changes !== 1) {
			throw invariant(`interaction \`${requestId}\` changed while preparing a response`);
		}
		return 'dispatch';
	});
}

export function abortInteractionDispatch(
	db: MaliniDatabase,
	kind: InteractionKind,
	sessionId: string,
	runId: string,
	requestId: string,
	intendedResponse: unknown,
): void {
	run(
		db,
		`UPDATE agent_interactions SET state = 'pending', intended_response_json = NULL
		 WHERE kind = ? AND session_id = ? AND run_id = ? AND request_id = ?
		   AND state = 'dispatching' AND intended_response_json = ?`,
		kind,
		sessionId,
		runId,
		requestId,
		canonicalJson(intendedResponse),
	);
}

export interface FinalizeInteractionResponseInput {
	kind: InteractionKind;
	sessionId: string;
	runId: string;
	requestId: string;
	intendedResponse: unknown;
	decision: InteractionDecision;
	scope: InteractionScope | null;
	source: InteractionSource;
	decidedAt: string;
	remember?: RememberPermissionRule | null;
	matchedRuleId?: string | null;
}

export function finalizeInteractionResponse(
	db: MaliniDatabase,
	input: FinalizeInteractionResponseInput,
): string | null {
	const {
		kind,
		sessionId,
		runId,
		requestId,
		intendedResponse,
		decision,
		scope,
		source,
		decidedAt,
	} = input;
	const remember = input.remember ?? null;
	const matchedRuleId = input.matchedRuleId ?? null;

	const shapeValid =
		kind === 'approval'
			? (decision === 'allow' || decision === 'deny') &&
				(scope === 'once' || scope === 'session' || scope === 'workstream')
			: kind === 'question'
				? decision === 'answered' && scope === null
				: false;
	const sourceValid =
		source === 'manual'
			? matchedRuleId === null
			: source === 'auto'
				? kind === 'approval' &&
					decision === 'allow' &&
					(scope === 'session' || scope === 'workstream') &&
					remember === null &&
					matchedRuleId !== null
				: false;
	if (!shapeValid || !sourceValid) throw invariant('invalid interaction resolution shape');

	return db.transaction(() => {
		const record = loadInteraction(db, kind, sessionId, runId, requestId);
		if (!record) throw invariant(`interaction \`${requestId}\` disappeared before resolution`);
		if (
			record.state !== 'dispatching' ||
			record.intendedResponse === null ||
			!jsonEqual(record.intendedResponse, intendedResponse)
		) {
			throw invariant(`interaction \`${requestId}\` is not dispatching this response`);
		}
		const { changes } = run(
			db,
			`UPDATE agent_interactions SET state = 'resolved', response_json = ?,
			 decision = ?, scope = ?, source = ?, decided_at = ?
			 WHERE kind = ? AND session_id = ? AND run_id = ? AND request_id = ?
			   AND state = 'dispatching'`,
			canonicalJson(intendedResponse),
			decision,
			scope,
			source,
			decidedAt,
			kind,
			sessionId,
			runId,
			requestId,
		);
		if (changes !== 1) {
			throw invariant(`interaction \`${requestId}\` resolution lost its pending state`);
		}

		let effectiveRuleId: string | null = null;
		if (remember) {
			if (
				kind !== 'approval' ||
				decision !== 'allow' ||
				(remember.scope !== 'session' && remember.scope !== 'workstream') ||
				scope !== remember.scope ||
				record.permissionFingerprint !== remember.permissionFingerprint
			) {
				throw invariant('remembered rule does not match the approved request');
			}
			const ruleSession = remember.scope === 'session' ? sessionId : null;
			const existing = findActivePermissionRule(
				db,
				record.workstreamId,
				sessionId,
				remember.permissionFingerprint,
				remember.scope,
			);
			if (existing) {
				effectiveRuleId = existing.id;
			} else {
				run(
					db,
					`INSERT INTO agent_permission_rules
					 (id, scope, workstream_id, session_id, permission_fingerprint,
					  permission_json, created_run_id, created_request_id, created_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					remember.id,
					remember.scope,
					record.workstreamId,
					ruleSession,
					remember.permissionFingerprint,
					canonicalJson(remember.permission),
					runId,
					requestId,
					decidedAt,
				);
				effectiveRuleId = remember.id;
			}
		}
		if (matchedRuleId !== null) {
			const touched = run(
				db,
				`UPDATE agent_permission_rules SET last_used_at = ?
				 WHERE id = ? AND workstream_id = ?
				   AND permission_fingerprint = ?
				   AND (scope = 'workstream' OR (scope = 'session' AND session_id = ?))`,
				decidedAt,
				matchedRuleId,
				record.workstreamId,
				record.permissionFingerprint,
				sessionId,
			).changes;
			if (touched !== 1) {
				throw invariant(
					`matched permission rule \`${matchedRuleId}\` no longer matches the approval context`,
				);
			}
			effectiveRuleId = matchedRuleId;
		}
		run(
			db,
			`UPDATE agent_sessions SET status = 'running' WHERE id = ? AND archived_at IS NULL
			 AND EXISTS (SELECT 1 FROM agent_runs WHERE id = ? AND session_id = ?
			             AND completed_at IS NULL)`,
			sessionId,
			runId,
			sessionId,
		);
		return effectiveRuleId;
	});
}
