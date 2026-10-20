import type { ExtensionManifest } from '@malini/extension-api';

import { WebExtensionSettingStorage } from '../../infrastructure/host/contributions.adapter';
import { createRegisteredExtensionSettingsAccess } from '../../infrastructure/services/extension-settings.service';
import { extensionSettingsAccessStore } from '../../infrastructure/stores/extension-settings-access.store.svelte';

export function registerExtensionSettingsHook(manifest: ExtensionManifest): () => void {
	const registration = createRegisteredExtensionSettingsAccess(
		manifest,
		new WebExtensionSettingStorage(globalThis.localStorage),
	);
	extensionSettingsAccessStore.register(manifest.id, registration.access);
	return () => {
		extensionSettingsAccessStore.release(manifest.id, registration.access);
		void registration.dispose();
	};
}
