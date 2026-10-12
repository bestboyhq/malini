import { describe, expect, it } from 'vitest';
import { createFakePlatform } from './create-fake-platform';
import { defaultProviderCapabilities } from './seed';

describe('providers fake', () => {
	it('walks Claude Code from missing through install and sign-in to a switched account', async () => {
		const missing = { ...defaultProviderCapabilities[0]!, state: 'missing' as const };
		const fake = createFakePlatform({ providerCapabilities: [missing] });

		await fake.invoke('providers.install-claude-code', undefined);
		const [installed] = await fake.invoke('chat.agent-capabilities', {});
		expect(await fake.invoke('providers.sign-in-to-claude', {})).toBe('signed-in');
		const [signedIn] = await fake.invoke('chat.agent-capabilities', {});
		await fake.invoke('providers.sign-in-to-claude', { email: 'work@example.com' });
		const [switched] = await fake.invoke('chat.agent-capabilities', {});

		expect(installed?.state).toBe('needs_auth');
		expect(signedIn?.state).toBe('ready');
		expect(signedIn?.account?.plan).toBe('Claude Max');
		expect(switched?.account?.email).toBe('work@example.com');
	});
});
