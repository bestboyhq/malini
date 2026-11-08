import type { PermissionGrantRecord } from '$contract/approvals';

export function permissionGrantWhere(grant: PermissionGrantRecord): string {
	if (grant.scope === 'everywhere') return 'Everywhere';
	if (grant.scope === 'repository') return grant.repositoryName ?? 'A removed repository';
	const workstream = grant.workstreamName ?? 'a removed workstream';
	return grant.scope === 'session' ? `One chat in ${workstream}` : `Workstream ${workstream}`;
}
