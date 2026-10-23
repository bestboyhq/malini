import { permissionGrantsAggregate } from '$lib/chat/infrastructure/aggregates/permission-grants.aggregate.svelte';
import { permissionGrantsService } from '$lib/chat/infrastructure/services/permission-grants.service';

export function loadPermissionGrantsCommand(): void {
	void (async () => {
		try {
			permissionGrantsAggregate.replace(await permissionGrantsService.list());
		} catch (error) {
			permissionGrantsAggregate.fail(error instanceof Error ? error.message : String(error));
		}
	})();
}
