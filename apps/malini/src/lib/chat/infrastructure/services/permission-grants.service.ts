import type { PermissionGrantRecord } from '$contract/approvals';
import { invoke } from '$shared/port/invoke';

class PermissionGrantsService {
	list(): Promise<PermissionGrantRecord[]> {
		return invoke('chat.list-permission-grants', undefined);
	}

	revoke(grantId: string): Promise<void> {
		return invoke('chat.revoke-permission-grant', { grantId });
	}
}

export const permissionGrantsService = new PermissionGrantsService();
