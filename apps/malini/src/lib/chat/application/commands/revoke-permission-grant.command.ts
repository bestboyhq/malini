import { permissionGrantsAggregate } from '$lib/chat/infrastructure/aggregates/permission-grants.aggregate.svelte';
import { permissionGrantsService } from '$lib/chat/infrastructure/services/permission-grants.service';

export function revokePermissionGrantCommand(grantId: string): void {
	void (async () => {
		try {
			await permissionGrantsService.revoke(grantId);
			permissionGrantsAggregate.remove(grantId);
		} catch (error) {
			permissionGrantsAggregate.fail(error instanceof Error ? error.message : String(error));
		}
	})();
}
