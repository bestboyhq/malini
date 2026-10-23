import type { PermissionGrantRecord } from '$contract/approvals';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { isRecord, nowIso8601 } from '$main/db/rows';
import { maliniActionLabel } from '../agent/malini-approvals.service';
import {
	listActivePermissionRules,
	revokePermissionRuleById,
	revokePermissionRulesFor,
	type ActivePermissionRule,
} from '../permissions.repository';
import { maliniActionFingerprint, rememberedResources } from '../permissions.service';

export function installPermissionGrants(context: MainContext): () => void {
	const { commands, db, events } = context;

	commands.define('chat.list-permission-grants', () =>
		listActivePermissionRules(db).map((rule) => grantRecord(db, rule)),
	);
	commands.define('chat.revoke-permission-grant', (args: unknown) => {
		const grantId = isRecord(args) ? args['grantId'] : undefined;
		if (typeof grantId !== 'string' || grantId.length === 0) {
			throw new Error('invalid args: `grantId` must be a non-empty string');
		}
		revokePermissionRuleById(db, grantId, nowIso8601());
	});

	return events.subscribe('jobs:definition-changed', ({ definitionId, definition }) => {
		if (definition !== null) return;
		revokePermissionRulesFor(db, maliniActionFingerprint(`jobs.run:${definitionId}`), nowIso8601());
	});
}

function grantRecord(db: MaliniDatabase, rule: ActivePermissionRule): PermissionGrantRecord {
	const resources = rememberedResources(rule.permissionJson);
	const action = resources.find((resource) => resource.kind === 'action');
	return {
		id: rule.id,
		scope: rule.scope,
		what: action
			? maliniActionLabel(db, action.value)
			: `Read ${resources.map((resource) => resource.value).join(', ')}`,
		workstreamName: rule.workstreamName,
		createdAt: rule.createdAt,
		lastUsedAt: rule.lastUsedAt,
	};
}
