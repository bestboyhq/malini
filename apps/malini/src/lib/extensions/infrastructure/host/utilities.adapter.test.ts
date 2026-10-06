import { afterEach, describe, expect, it, vi } from 'vitest';

import { rendererErrorSinkSnapshot } from '$shared/errors/renderer-error-sink';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';

import {
	createDesktopExtensionClock,
	createDesktopExtensionIds,
	createDesktopExtensionSecrets,
	createDesktopExtensionUI,
} from './utilities.adapter';

afterEach(() => {
	setPlatformForTest(null);
});

function installFake(): FakePlatform {
	const fake = createFakePlatform();
	setPlatformForTest(fake);
	return fake;
}

function secretCalls(fake: FakePlatform): readonly { command: string; args: unknown }[] {
	return fake.calls.filter(({ command }) => command.endsWith('-secret'));
}

describe('desktop extension utility adapters', () => {
	it('supports abortable sleeps without an animation-frame dependency', async () => {
		vi.useFakeTimers();
		const clock = createDesktopExtensionClock();
		const abort = new AbortController();
		const sleeping = clock.sleep(500, abort.signal);
		abort.abort(new Error('cancelled'));
		await expect(sleeping).rejects.toThrow('cancelled');
		vi.useRealTimers();
	});

	it('namespaces IDs per extension', () => {
		const ids = createDesktopExtensionIds(() => 'fixed');
		expect(ids.next('verification')).toBe('verification-fixed');
	});

	it('round-trips namespaced extension secrets locally without invoking native storage', async () => {
		const platform = installFake();
		const values = new Map<string, string>();
		const storage = {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => {
				values.set(key, value);
			},
			removeItem: (key: string) => {
				values.delete(key);
			},
		};
		const secrets = createDesktopExtensionSecrets({
			extensionId: 'example.safe',
			storage,
			nativeKeychainEnabled: false,
		});

		await expect(secrets.get('token')).resolves.toBeNull();
		await secrets.set('token', 'new-value');
		await expect(secrets.get('token')).resolves.toBe('new-value');
		expect(values.get('malini.extension.example.safe:token')).toBe('new-value');
		await secrets.delete('token');
		await expect(secrets.get('token')).resolves.toBeNull();
		expect(secretCalls(platform)).toEqual([]);
	});

	it('records the unprotected localStorage secret fallback once, durably', async () => {
		const reportWarning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		try {
			installFake();
			const values = new Map<string, string>();
			const secrets = createDesktopExtensionSecrets({
				extensionId: 'example.linear',
				storage: {
					getItem: (key: string) => values.get(key) ?? null,
					setItem: (key: string, value: string) => {
						values.set(key, value);
					},
					removeItem: (key: string) => {
						values.delete(key);
					},
				},
				nativeKeychainEnabled: false,
			});
			const before = rendererErrorSinkSnapshot();
			expect(reportWarning).not.toHaveBeenCalled();

			await secrets.set('api-key', 'lin_api_plaintext');
			await secrets.get('api-key');
			await secrets.delete('api-key');

			const after = rendererErrorSinkSnapshot();
			expect(after.attempted).toBe(before.attempted + 1);
			expect(after.lastPayload?.error.name).toBe('UnprotectedSecretStorage');
			const recorded = after.lastPayload?.error.message ?? '';
			expect(recorded).toContain('malini.extension.example.linear');
			expect(recorded).toMatch(/localStorage/iu);
			expect(recorded).toMatch(/PUBLIC_USE_KEYCHAIN/u);
			expect(reportWarning).toHaveBeenCalledTimes(1);
			expect(
				`${recorded} ${reportWarning.mock.calls.flat().map(String).join(' ')}`,
				'the report must never carry the secret it warns about',
			).not.toContain('lin_api_plaintext');
		} finally {
			reportWarning.mockRestore();
		}
	});

	it('records nothing when native extension secret storage is in use', async () => {
		const reportWarning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		try {
			installFake();
			const secrets = createDesktopExtensionSecrets({
				extensionId: 'example.linear',
				nativeKeychainEnabled: true,
			});
			const before = rendererErrorSinkSnapshot();
			await secrets.set('api-key', 'value');
			await secrets.get('api-key');
			expect(rendererErrorSinkSnapshot().attempted).toBe(before.attempted);
			expect(reportWarning).not.toHaveBeenCalled();
		} finally {
			reportWarning.mockRestore();
		}
	});

	it('uses native extension secret storage only when Keychain is explicitly enabled', async () => {
		const platform = installFake();
		const secrets = createDesktopExtensionSecrets({
			extensionId: 'example.safe',
			nativeKeychainEnabled: true,
		});

		await secrets.get('token');
		await secrets.set('token', 'new-value');
		await secrets.delete('token');
		expect(secretCalls(platform)).toEqual([
			{
				command: 'app.get-secret',
				args: { service: 'malini.extension.example.safe', key: 'token' },
			},
			{
				command: 'app.set-secret',
				args: { service: 'malini.extension.example.safe', key: 'token', value: 'new-value' },
			},
			{
				command: 'app.delete-secret',
				args: { service: 'malini.extension.example.safe', key: 'token' },
			},
		]);
	});

	it('opens only normal web URLs', async () => {
		const platform = installFake();
		const ui = createDesktopExtensionUI();
		await ui.openExternal('https://example.com/path');
		await expect(ui.openExternal('file:///tmp/private')).rejects.toThrow('HTTP(S)');
		expect(platform.calls).toEqual([
			{ command: 'app.open-external-url', args: { url: 'https://example.com/path' } },
		]);
	});
});
