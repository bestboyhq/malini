import { describe, expect, it } from 'vitest';
import { openMigratedDatabase } from '$main/db/open';
import { all } from '$main/db/rows';
import type { SecretCipher } from './claude-accounts.service';
import { setProviderModels } from './provider.repository';
import { ProviderKeys } from './provider-keys.service';

function cipher(): SecretCipher {
	return {
		isEncryptionAvailable: () => true,
		encryptString: (plainText) => Buffer.from(`sealed:${plainText}`),
		decryptString: (encrypted) => encrypted.toString().replace(/^sealed:/u, ''),
	};
}

function keys(): ProviderKeys {
	return new ProviderKeys(openMigratedDatabase(':memory:'), async () => cipher());
}

describe('ProviderKeys', () => {
	it('lists Claude and the seeded DeepSeek, OpenCode and ChatGPT models without a key', () => {
		const providers = keys().list();
		expect(providers.map((provider) => provider.id)).toEqual([
			'claude',
			'deepseek',
			'opencode',
			'chatgpt',
		]);
		expect(providers[1]).toEqual({
			id: 'deepseek',
			name: 'DeepSeek',
			kind: 'anthropic',
			baseUrl: 'https://api.deepseek.com/anthropic',
			models: [
				{
					id: 'deepseek-flash',
					label: 'DeepSeek V4.1 Flash',
					description: 'Text and images, 1M context',
					efforts: ['low', 'high', 'max'],
					family: 'deepseek-flash',
				},
				{
					id: 'deepseek-v4-pro',
					label: 'DeepSeek V4 Pro',
					description: 'Text only, 1M context',
					efforts: ['low', 'high', 'max'],
					family: 'deepseek-thinking',
				},
			],
			keySaved: false,
			account: null,
		});
	});

	it('seals the key, never stores it as plain text, and resolves the run environment', async () => {
		const db = openMigratedDatabase(':memory:');
		const providers = new ProviderKeys(db, async () => cipher());
		await providers.save('deepseek', '  sk-test  ');

		const [stored] = all<{ api_key: Uint8Array }>(
			db,
			"SELECT api_key FROM model_providers WHERE id = 'deepseek'",
		);
		expect(stored?.api_key).toBeInstanceOf(Uint8Array);
		expect(Buffer.from(stored?.api_key ?? []).toString()).toBe('sealed:sk-test');
		expect(providers.list()[1]?.keySaved).toBe(true);
		await expect(providers.environment('deepseek', 'deepseek-v4-pro')).resolves.toEqual({
			ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
			ANTHROPIC_AUTH_TOKEN: 'sk-test',
			ANTHROPIC_MODEL: 'deepseek-v4-pro',
			ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-pro',
			ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-pro',
			ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-pro',
			CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-flash',
		});
		await expect(providers.environment('claude', 'opus')).resolves.toEqual({});
	});

	it('runs OpenCode subagents on the chat model and drops a subagent model the provider no longer offers', async () => {
		const db = openMigratedDatabase(':memory:');
		const providers = new ProviderKeys(db, async () => cipher());
		await providers.save('opencode', 'oc_sk_test');
		await expect(providers.environment('opencode', 'minimax-m3')).resolves.toEqual({
			ANTHROPIC_BASE_URL: 'https://opencode.ai/inference/anthropic',
			ANTHROPIC_AUTH_TOKEN: 'oc_sk_test',
			ANTHROPIC_MODEL: 'minimax-m3',
			ANTHROPIC_DEFAULT_OPUS_MODEL: 'minimax-m3',
			ANTHROPIC_DEFAULT_SONNET_MODEL: 'minimax-m3',
			ANTHROPIC_DEFAULT_HAIKU_MODEL: 'minimax-m3',
			CLAUDE_CODE_SUBAGENT_MODEL: 'minimax-m3',
		});
		await providers.save('deepseek', 'sk-test');
		setProviderModels(db, 'deepseek', [
			{ id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', description: '', efforts: [] },
		]);
		await expect(providers.environment('deepseek', 'deepseek-v4-pro')).resolves.toMatchObject({
			CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-v4-pro',
		});
	});

	it('removes the key and refuses a model the provider does not offer to a new session', async () => {
		const providers = keys();
		await providers.save('deepseek', 'sk-test');
		await expect(providers.environment('deepseek', 'deepseek-chat')).rejects.toThrow(
			'DeepSeek does not offer model `deepseek-chat`',
		);
		await expect(
			providers.environment('deepseek', 'deepseek-chat', 'reopened'),
		).resolves.toMatchObject({ ANTHROPIC_MODEL: 'deepseek-chat' });
		providers.delete('deepseek');
		expect(providers.list()[1]?.keySaved).toBe(false);
		await expect(providers.environment('deepseek', 'deepseek-v4-pro')).rejects.toThrow(
			'DeepSeek needs an API key. Add it in Settings, then try again.',
		);
	});

	it('refuses Claude, an unknown provider, and an empty key', async () => {
		const providers = keys();
		await expect(providers.save('claude', 'sk-test')).rejects.toThrow('Unknown provider `claude`');
		await expect(providers.save('missing', 'sk-test')).rejects.toThrow(
			'Unknown provider `missing`',
		);
		await expect(providers.save('deepseek', '   ')).rejects.toThrow('The API key is not valid.');
	});
});
