import { describe, expect, it } from 'vitest';

import { resolveDirectorySettingScope } from '$shared/extensions/settings-access';

import {
	ExtensionSettingsAccess,
	createRegisteredExtensionSettingsAccess,
} from './extension-settings.service';

describe('extension settings pages', () => {
	it('uses public manifest definitions and the production extension settings key format', async () => {
		const values = new Map<string, string>();
		const access = new ExtensionSettingsAccess({
			get: (key) => values.get(key) ?? null,
			set: (key, value) => {
				values.set(key, value);
			},
			delete: (key) => {
				values.delete(key);
			},
		});
		const definition = {
			id: 'acme.extension.mode',
			label: 'Mode',
			type: 'select' as const,
			default: 'smart',
			options: [
				{ label: 'Smart', value: 'smart' },
				{ label: 'Manual', value: 'manual' },
			],
		};
		const extensionManifest = {
			...manifest('acme.extension', '1.0.0'),
			contributes: { settings: [definition] },
		};
		expect(access.definitions(extensionManifest)).toEqual([definition]);
		const scope = { kind: 'global' as const };
		expect(access.get(extensionManifest.id, definition, scope)).toBe('smart');
		await access.set(extensionManifest.id, definition, 'manual', scope);
		expect(access.get(extensionManifest.id, definition, scope)).toBe('manual');
		expect([...values.keys()][0]).toContain(
			'malini.extensions.settings.v1/acme.extension/global/acme.extension.mode',
		);
		await expect(access.set(extensionManifest.id, definition, 'invalid', scope)).rejects.toThrow(
			'Invalid value',
		);
	});

	it('registers directory controls through the production contribution host', async () => {
		const values = new Map<string, string>();
		const storage = {
			get: (key: string) => values.get(key) ?? null,
			set: (key: string, value: string) => {
				values.set(key, value);
			},
			delete: (key: string) => {
				values.delete(key);
			},
		};
		const definition = {
			id: 'acme.extension.enabled',
			label: 'Enabled',
			type: 'boolean' as const,
			default: true,
		};
		const extensionManifest = {
			...manifest('acme.extension', '1.0.0'),
			contributes: { settings: [definition] },
		};
		const registered = createRegisteredExtensionSettingsAccess(extensionManifest, storage);
		expect(registered.host.listSettings(extensionManifest.id)).toEqual([definition]);
		await registered.access.set(extensionManifest.id, definition, false, { kind: 'global' });
		expect(registered.host.getSetting(definition.id, { kind: 'global' })).toBe(false);
		await registered.dispose();
		expect(registered.host.listSettings(extensionManifest.id)).toEqual([]);
	});

	it('does not silently collapse repository settings into global settings', () => {
		const definition = {
			id: 'acme.extension.command',
			label: 'Command',
			type: 'string' as const,
			default: 'pnpm dev',
			scope: 'repository' as const,
		};
		expect(resolveDirectorySettingScope(definition, {})).toBeNull();
		expect(
			resolveDirectorySettingScope(definition, { repositoryPath: '/repositories/acme' }),
		).toEqual({
			kind: 'repository',
			id: '/repositories/acme',
		});
		expect(
			resolveDirectorySettingScope(definition, {
				repositoryPath: '/worktrees/one',
				repositoryFullName: ' acme/web ',
			}),
		).toEqual({ kind: 'repository', id: 'acme/web' });
		expect(
			resolveDirectorySettingScope(definition, {
				repositoryPath: '/worktrees/two',
				repositoryFullName: 'acme/web',
			}),
		).toEqual({ kind: 'repository', id: 'acme/web' });
		expect(
			resolveDirectorySettingScope(definition, {
				repositoryPath: '/worktrees/other',
				repositoryFullName: 'acme/other',
			}),
		).toEqual({ kind: 'repository', id: 'acme/other' });
	});
});

function manifest(id: string, version: string) {
	return {
		schemaVersion: 1 as const,
		id,
		name: 'Extension',
		version,
		apiVersion: 1 as const,
		description: 'Extension',
		publisher: 'Acme',
		entrypoint: './dist/index.js',
		activationEvents: ['onStartup' as const],
	};
}
