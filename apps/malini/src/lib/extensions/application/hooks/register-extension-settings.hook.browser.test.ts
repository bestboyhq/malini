import type { ExtensionManifest } from '@malini/extension-api';
import { afterEach, describe, expect, it } from 'vitest';

import { extensionSettingsAccessQuery } from '../queries/extension-settings-access.query.svelte';
import { registerExtensionSettingsHook } from './register-extension-settings.hook';

const manifest: ExtensionManifest = {
	schemaVersion: 1,
	id: 'example.settings',
	name: 'Settings example',
	version: '1.0.0',
	apiVersion: 1,
	description: 'Exercises settings registration',
	publisher: 'Example',
	entrypoint: './dist/index.js',
	activationEvents: ['onStartup'],
	contributes: {
		settings: [{ id: 'example.settings.mode', label: 'Mode', type: 'string', default: 'fast' }],
	},
};

afterEach(() => {
	globalThis.localStorage.clear();
});

describe('registerExtensionSettingsHook', () => {
	it('exposes the extension settings while registered and withdraws them on release', async () => {
		const release = registerExtensionSettingsHook(manifest);
		const access = extensionSettingsAccessQuery.data(manifest.id);
		const [definition] = access?.definitions(manifest) ?? [];
		if (!access || !definition) throw new Error('Expected registered extension settings');

		expect(access.get(manifest.id, definition, { kind: 'global' })).toBe('fast');
		await access.set(manifest.id, definition, 'thorough', { kind: 'global' });
		expect(access.get(manifest.id, definition, { kind: 'global' })).toBe('thorough');

		release();
		expect(extensionSettingsAccessQuery.data(manifest.id)).toBeNull();
	});

	it('keeps a newer registration when an older one is released', () => {
		const releaseFirst = registerExtensionSettingsHook(manifest);
		const releaseSecond = registerExtensionSettingsHook(manifest);
		const current = extensionSettingsAccessQuery.data(manifest.id);

		releaseFirst();

		expect(extensionSettingsAccessQuery.data(manifest.id)).toBe(current);
		releaseSecond();
		expect(extensionSettingsAccessQuery.data(manifest.id)).toBeNull();
	});
});
