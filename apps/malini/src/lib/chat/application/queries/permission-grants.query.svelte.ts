import type { PermissionGrantRecord } from '$contract/approvals';
import { permissionGrantsAggregate } from '$lib/chat/infrastructure/aggregates/permission-grants.aggregate.svelte';

class PermissionGrantsQuery {
	public readonly data: Readonly<{
		grants: readonly PermissionGrantRecord[] | null;
		failure: string | null;
	}> = $derived({
		grants: permissionGrantsAggregate.grants,
		failure: permissionGrantsAggregate.failure,
	});
}

export const permissionGrantsQuery = new PermissionGrantsQuery();
