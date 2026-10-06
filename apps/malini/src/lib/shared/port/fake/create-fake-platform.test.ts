import { describe, expect, it } from 'vitest';
import { COMMAND_NAMES } from '$contract/commands';
import { createFakePlatform } from './create-fake-platform';

describe('the fake platform', () => {
	it('answers every command the main process registers', () => {
		expect(createFakePlatform().names()).toEqual([...COMMAND_NAMES].sort());
	});

	it('starts over from a new seed, forgetting calls and listeners', async () => {
		const fake = createFakePlatform();
		const received: unknown[] = [];
		fake.on('app:scale-changed', (payload) => received.push(payload));
		await fake.invoke('app.set-setting', { key: 'theme', value: 'dark' });

		fake.seed({ settings: { density: 'compact' } });
		fake.emit('app:scale-changed', {});

		expect(fake.calls).toEqual([]);
		expect(received).toEqual([]);
		await expect(fake.invoke('app.list-settings', undefined)).resolves.not.toHaveProperty('theme');
		await expect(fake.invoke('app.list-settings', undefined)).resolves.toMatchObject({
			density: 'compact',
		});
	});

	it('hands out snapshots the caller cannot use to reach into its state', async () => {
		const fake = createFakePlatform({ secrets: { 'svc:key': 'value' } });

		const snapshot = fake.snapshot();
		snapshot.settings['injected'] = 'yes';
		snapshot.workstreams.length = 0;

		expect(snapshot.secrets).toEqual({ 'svc:key': 'value' });
		await expect(fake.invoke('app.list-settings', undefined)).resolves.not.toHaveProperty(
			'injected',
		);
		expect(fake.snapshot().workstreams.length).toBeGreaterThan(0);
	});
});
