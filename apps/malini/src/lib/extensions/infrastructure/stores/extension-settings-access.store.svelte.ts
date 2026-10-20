import type { ExtensionSettingsAccessPort } from '$shared/extensions/settings-access';

class ExtensionSettingsAccessStore {
	registrations = $state.raw<Readonly<Record<string, ExtensionSettingsAccessPort>>>({});

	register(extensionId: string, access: ExtensionSettingsAccessPort): void {
		this.registrations = { ...this.registrations, [extensionId]: access };
	}

	release(extensionId: string, access: ExtensionSettingsAccessPort): void {
		if (this.registrations[extensionId] !== access) return;
		const { [extensionId]: _released, ...remaining } = this.registrations;
		this.registrations = remaining;
	}
}

export const extensionSettingsAccessStore = new ExtensionSettingsAccessStore();
