import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';

class ExtensionRuntimeReadyQuery {
	public readonly data: (workstreamId: string) => boolean = $derived(
		(workstreamId: string) =>
			extensionRuntimeStore.ready && extensionRuntimeStore.service?.workstream?.id === workstreamId,
	);
}

export const extensionRuntimeReadyQuery = new ExtensionRuntimeReadyQuery();
