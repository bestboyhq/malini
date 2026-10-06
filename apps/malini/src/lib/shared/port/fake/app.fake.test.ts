import { describe, expect, it } from 'vitest';
import { createFakePlatform } from './create-fake-platform';

describe('fake app commands', () => {
	it('returns a deterministic desktop runtime identity', async () => {
		const fake = createFakePlatform();

		await expect(fake.invoke('app.runtime-identity', undefined)).resolves.toEqual({
			productName: 'malini Fake',
			bundleIdentifier: 'com.malini.app.fake',
			version: '0.0.0-fake',
			buildProfile: 'debug',
			pid: 4_242,
			executablePath: '/fake/malini Fake.app/Contents/MacOS/malini',
			executableFingerprint: 'fake-executable-sha256',
			appDataRoot: '/fake/Library/Application Support/com.malini.app.fake',
		});
		expect(fake.calls.at(-1)).toEqual({ command: 'app.runtime-identity', args: undefined });
	});

	it('round-trips secrets and settings', async () => {
		const fake = createFakePlatform();

		await fake.invoke('app.set-secret', { service: 'github', key: 'main', value: 'secret-token' });
		expect(await fake.invoke('app.get-secret', { service: 'github', key: 'main' })).toBe(
			'secret-token',
		);
		expect(fake.snapshot().secrets).toEqual({ 'github:main': 'secret-token' });
		await fake.invoke('app.delete-secret', { service: 'github', key: 'main' });
		expect(await fake.invoke('app.get-secret', { service: 'github', key: 'main' })).toBeNull();

		await fake.invoke('app.set-setting', { key: 'chat.model', value: 'claude-opus-4-8' });
		expect(await fake.invoke('app.list-settings', undefined)).toMatchObject({
			'chat.model': 'claude-opus-4-8',
		});
	});

	it('answers the window and notification calls and records each one', async () => {
		const fake = createFakePlatform();

		await fake.invoke('app.focus-window', undefined);
		await fake.invoke('app.open-external-url', { url: 'https://github.com/login/device' });
		await fake.invoke('app.copy-text', { text: 'SMK-FAKE' });
		await fake.invoke('app.interface-scale', { scale: 1.05 });
		await fake.invoke('app.notify', { options: { title: 'malini', body: 'Done' } });
		expect(await fake.invoke('app.notification-permission-granted', undefined)).toBe(true);
		expect(await fake.invoke('app.request-notification-permission', undefined)).toBe('granted');
		expect(fake.calls.map(({ command }) => command)).toEqual([
			'app.focus-window',
			'app.open-external-url',
			'app.copy-text',
			'app.interface-scale',
			'app.notify',
			'app.notification-permission-granted',
			'app.request-notification-permission',
		]);
		expect(fake.calls[1]).toEqual({
			command: 'app.open-external-url',
			args: { url: 'https://github.com/login/device' },
		});
	});

	it('supports manual event emission and unlisten', () => {
		const fake = createFakePlatform();
		const received: unknown[] = [];
		const off = fake.on('app:scale-changed', (payload) => received.push(payload));

		fake.emit('app:scale-changed', { value: 1 });
		expect(fake.listenerCount('app:scale-changed')).toBe(1);
		off();
		fake.emit('app:scale-changed', { value: 2 });

		expect(received).toEqual([{ value: 1 }]);
		expect(fake.listenerCount('app:scale-changed')).toBe(0);
	});
});
