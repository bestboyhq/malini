import { describe, expect, it } from 'vitest';
import { createFakePlatform } from './create-fake-platform';
import { defaultProviderCapabilities } from './seed';

describe('providers fake', () => {
	it('walks Claude Code from missing through install and sign-in to ready', async () => {
		const missing = { ...defaultProviderCapabilities[0]!, state: 'missing' as const };
		const fake = createFakePlatform({ providerCapabilities: [missing] });

		await fake.invoke('providers.run-claude-setup', { step: 'install' });
		const [installed] = await fake.invoke('chat.agent-capabilities', {});
		await fake.invoke('providers.run-claude-setup', { step: 'sign-in' });
		const [signedIn] = await fake.invoke('chat.agent-capabilities', {});

		expect(installed?.state).toBe('needs_auth');
		expect(signedIn?.state).toBe('ready');
		expect(signedIn?.account?.plan).toBe('Claude Max');
	});
});
