import { homedir } from 'node:os';
import type { PermissionGrantRecord } from '$contract/approvals';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { isRecord, nowIso8601 } from '$main/db/rows';
import {
	getProject,
	projectFullName,
	repositoryName,
} from '$shared/repositories/repositories.platform';
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

	return events.subscribe('automations:definition-changed', ({ definitionId, definition }) => {
		if (definition !== null) return;
		revokePermissionRulesFor(
			db,
			maliniActionFingerprint(`automations.run:${definitionId}`),
			nowIso8601(),
		);
	});
}

function grantRecord(db: MaliniDatabase, rule: ActivePermissionRule): PermissionGrantRecord {
	return {
		id: rule.id,
		scope: rule.scope,
		what: grantWhat(db, rule.permissionJson),
		workstreamName: rule.workstreamName,
		repositoryName: rule.repositoryId === null ? null : shownRepositoryName(db, rule.repositoryId),
		createdAt: rule.createdAt,
		lastUsedAt: rule.lastUsedAt,
	};
}

function grantWhat(db: MaliniDatabase, permissionJson: string): string {
	const resources = rememberedResources(permissionJson);
	const action = resources.find((resource) => resource.kind === 'action');
	if (action) return maliniActionLabel(db, action.value);
	if (!isSandboxGrant(permissionJson)) {
		return `Read ${resources.map((resource) => resource.value).join(', ')}`;
	}
	const home = homedir();
	const opens = resources.map(({ kind, value }) => {
		const shown =
			value === home || value.startsWith(`${home}/`) ? `~${value.slice(home.length)}` : value;
		return `${kind === 'socket' ? 'connect to' : 'write'} ${shown}`;
	});
	return `Sandbox: ${opens.join(', ')}`;
}

function shownRepositoryName(db: MaliniDatabase, repositoryId: string): string | null {
	const project = getProject(db, repositoryId);
	const fullName = project && projectFullName(project);
	return fullName ? repositoryName(fullName) : null;
}

function isSandboxGrant(permissionJson: string): boolean {
	const permission: unknown = JSON.parse(permissionJson);
	return isRecord(permission) && permission['capability'] === 'sandbox';
}
