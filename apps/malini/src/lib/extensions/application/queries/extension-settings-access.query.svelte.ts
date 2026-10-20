import type { ExtensionSettingsAccessPort } from '$shared/extensions/settings-access';

import { extensionSettingsAccessStore } from '../../infrastructure/stores/extension-settings-access.store.svelte';

class ExtensionSettingsAccessQuery {
	public readonly data: (extensionId: string) => ExtensionSettingsAccessPort | null = $derived(
		(extensionId: string) => extensionSettingsAccessStore.registrations[extensionId] ?? null,
	);
}

export const extensionSettingsAccessQuery = new ExtensionSettingsAccessQuery();
