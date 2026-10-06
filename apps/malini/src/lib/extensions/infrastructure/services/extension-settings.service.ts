import type {
	ExtensionManifest,
	ExtensionDisposable,
	ExtensionLifecycleScope,
	ExtensionSettingManifest,
	ExtensionSettingScope,
	ExtensionSettingValue,
} from '@malini/extension-api';
import type { ExtensionSettingStorage } from '../../domain/extension-storage';
import {
	DesktopExtensionContributionHost,
	extensionSettingStorageKey,
} from '../host/contributions.adapter';

const SETTINGS_STORAGE_VERSION = 1 as const;

export class ExtensionSettingsAccess {
	constructor(
		private readonly storage: ExtensionSettingStorage,
		private readonly contributionHost?: Pick<
			DesktopExtensionContributionHost,
			'getSetting' | 'setSetting' | 'listSettings'
		>,
	) {}

	definitions(manifest: ExtensionManifest): readonly ExtensionSettingManifest[] {
		const registered = this.contributionHost?.listSettings(manifest.id) ?? [];
		return registered.length > 0 ? registered : (manifest.contributes?.settings ?? []);
	}

	get(
		extensionId: string,
		definition: ExtensionSettingManifest,
		scope: ExtensionSettingScope,
	): ExtensionSettingValue {
		if (this.contributionHost?.listSettings(extensionId).some(({ id }) => id === definition.id)) {
			return this.contributionHost.getSetting(definition.id, scope);
		}
		const serialized = this.storage.get(
			extensionSettingStorageKey(extensionId, definition.id, scope),
		);
		if (serialized === null) return definition.default;
		try {
			const stored: unknown = JSON.parse(serialized);
			if (!isStoredSetting(stored)) return definition.default;
			assertValue(definition, stored.value);
			return stored.value;
		} catch {
			return definition.default;
		}
	}

	async set(
		extensionId: string,
		definition: ExtensionSettingManifest,
		value: ExtensionSettingValue,
		scope: ExtensionSettingScope,
	): Promise<void> {
		assertValue(definition, value);
		if (this.contributionHost?.listSettings(extensionId).some(({ id }) => id === definition.id)) {
			await this.contributionHost.setSetting(definition.id, value, scope);
			return;
		}
		this.storage.set(
			extensionSettingStorageKey(extensionId, definition.id, scope),
			JSON.stringify({ version: SETTINGS_STORAGE_VERSION, value }),
		);
	}
}

export function createRegisteredExtensionSettingsAccess(
	manifest: ExtensionManifest,
	storage: ExtensionSettingStorage,
): {
	access: ExtensionSettingsAccess;
	host: DesktopExtensionContributionHost;
	dispose(): Promise<void>;
} {
	const host = new DesktopExtensionContributionHost({ settingStorage: storage });
	const registrations: ExtensionDisposable[] = [];
	const lifecycle: ExtensionLifecycleScope = {
		track(disposable: ExtensionDisposable): ExtensionDisposable {
			registrations.push(disposable);
			return disposable;
		},
	};
	const api = host.createAPI(manifest, lifecycle);
	for (const definition of manifest.contributes?.settings ?? []) api.settings.register(definition);
	return {
		access: new ExtensionSettingsAccess(storage, host),
		host,
		dispose: async () => {
			for (const registration of [...registrations].reverse()) await registration.dispose();
			registrations.length = 0;
		},
	};
}

function assertValue(
	definition: ExtensionSettingManifest,
	value: unknown,
): asserts value is ExtensionSettingValue {
	if (definition.type === 'select') {
		if (
			typeof value !== 'string' ||
			!definition.options?.some((option) => option.value === value)
		) {
			throw new Error(`Invalid value for ${definition.label}`);
		}
		return;
	}
	if (typeof value !== definition.type) throw new Error(`Invalid value for ${definition.label}`);
}

function isStoredSetting(
	value: unknown,
): value is Readonly<{ version: typeof SETTINGS_STORAGE_VERSION; value: unknown }> {
	return (
		typeof value === 'object' &&
		value !== null &&
		'version' in value &&
		value.version === SETTINGS_STORAGE_VERSION
	);
}
