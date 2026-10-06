import type { ExtensionRepositoryEnablement } from '../../domain/extension-repository-enablement';
import { extensionRepositoryEnablementStore } from '../../infrastructure/stores/extension-repository-enablement.store.svelte';

class ExtensionRepositoryEnablementQuery {
	public readonly data: (
		workstreamId: string,
		extensionId: string,
	) => ExtensionRepositoryEnablement = $derived((workstreamId: string, extensionId: string) =>
		extensionRepositoryEnablementStore.get(workstreamId, extensionId),
	);
}

export const extensionRepositoryEnablementQuery = new ExtensionRepositoryEnablementQuery();
