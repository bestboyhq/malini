import type { PermissionGrantRecord } from '$contract/approvals';

class PermissionGrantsAggregate {
	grants = $state.raw<readonly PermissionGrantRecord[] | null>(null);
	failure = $state.raw<string | null>(null);

	replace(grants: readonly PermissionGrantRecord[]): void {
		this.grants = grants;
		this.failure = null;
	}

	remove(grantId: string): void {
		this.grants = (this.grants ?? []).filter((grant) => grant.id !== grantId);
	}

	fail(message: string): void {
		this.failure = message;
	}
}

export const permissionGrantsAggregate = new PermissionGrantsAggregate();
