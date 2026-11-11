import { describe, expect, it } from 'vitest';
import type { ProviderPlan } from '$contract/agent';
import { openMigratedDatabase } from '$main/db/open';
import { all } from '$main/db/rows';
import type { SecretCipher } from './claude-accounts.service';
import { setProviderModels, setProviderKey } from './provider.repository';
import { ProviderKeys, type PlanDetector } from './provider-keys.service';

function cipher(): SecretCipher {
	return {
		isEncryptionAvailable: () => true,
		encryptString: (plainText) => Buffer.from(`sealed:${plainText}`),
		decryptString: (encrypted) => encrypted.toString().replace(/^sealed:/u, ''),
	};
}

const LOCAL_PROXY = {
	keys: async (providerId: string) => ({
		baseUrl: `http://127.0.0.1:4100/${providerId}`,
		token: 'local-token',
	}),
};

function keys(detectPlan: PlanDetector = () => Promise.resolve('console')): ProviderKeys {
	return new ProviderKeys(
		openMigratedDatabase(':memory:'),
		async () => cipher(),
		detectPlan,
		LOCAL_PROXY,
	);
}

function openCodePlan(providers: ProviderKeys): ProviderPlan | null {
	return providers.list().find((provider) => provider.id === 'opencode')?.plan ?? null;
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
			plan: null,
		});
	});

	it('seals the key, never stores it as plain text, and runs through the local proxy', async () => {
		const db = openMigratedDatabase(':memory:');
		const providers = new ProviderKeys(
			db,
			async () => cipher(),
			async () => 'console',
			LOCAL_PROXY,
		);
		await providers.save('deepseek', '  sk-test  ');

		const [stored] = all<{ api_key: Uint8Array }>(
			db,
			"SELECT api_key FROM model_providers WHERE id = 'deepseek'",
		);
		expect(stored?.api_key).toBeInstanceOf(Uint8Array);
		expect(Buffer.from(stored?.api_key ?? []).toString()).toBe('sealed:sk-test');
		expect(providers.list()[1]?.keySaved).toBe(true);
		await expect(providers.environment('deepseek', 'deepseek-v4-pro')).resolves.toEqual({
			ANTHROPIC_BASE_URL: 'http://127.0.0.1:4100/deepseek',
			ANTHROPIC_AUTH_TOKEN: 'local-token',
			ANTHROPIC_MODEL: 'deepseek-v4-pro',
			ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-pro',
			ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-pro',
			ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-pro',
			CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-flash',
		});
		await expect(providers.upstream('deepseek')).resolves.toEqual({
			baseUrl: 'https://api.deepseek.com/anthropic',
			apiKey: 'sk-test',
		});
		await expect(providers.environment('claude', 'opus')).resolves.toEqual({});
	});

	it('runs OpenCode subagents on the chat model and drops a subagent model the provider no longer offers', async () => {
		const db = openMigratedDatabase(':memory:');
		const providers = new ProviderKeys(
			db,
			async () => cipher(),
			async () => 'console',
			LOCAL_PROXY,
		);
		await providers.save('opencode', 'oc_sk_test');
		await expect(providers.environment('opencode', 'minimax-m3')).resolves.toEqual({
			ANTHROPIC_BASE_URL: 'http://127.0.0.1:4100/opencode',
			ANTHROPIC_AUTH_TOKEN: 'local-token',
			ANTHROPIC_MODEL: 'minimax-m3',
			ANTHROPIC_DEFAULT_OPUS_MODEL: 'minimax-m3',
			ANTHROPIC_DEFAULT_SONNET_MODEL: 'minimax-m3',
			ANTHROPIC_DEFAULT_HAIKU_MODEL: 'minimax-m3',
			CLAUDE_CODE_SUBAGENT_MODEL: 'minimax-m3',
		});
		expect(openCodePlan(providers)).toBe('console');
		await providers.save('deepseek', 'sk-test');
		setProviderModels(db, 'deepseek', [
			{ id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', description: '', efforts: [] },
		]);
		await expect(providers.environment('deepseek', 'deepseek-v4-pro')).resolves.toMatchObject({
			CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-v4-pro',
		});
	});

	it('lists the Go models and runs them on the Go endpoint when the key is on the Go plan', async () => {
		const providers = new ProviderKeys(
			openMigratedDatabase(':memory:'),
			async () => cipher(),
			async () => 'go',
			LOCAL_PROXY,
		);
		await providers.save('opencode', 'oc_sk_go');
		const opencode = providers.list().find((provider) => provider.id === 'opencode');
		expect(opencode?.plan).toBe('go');
		expect(opencode?.baseUrl).toBe('https://opencode.ai/inference/go/anthropic');
		expect(opencode?.models.some((model) => model.id === 'hy4')).toBe(true);
		expect(opencode?.models.some((model) => model.id === 'claude-opus-5-5')).toBe(false);
		await expect(providers.upstream('opencode')).resolves.toEqual({
			baseUrl: 'https://opencode.ai/inference/go/anthropic',
			apiKey: 'oc_sk_go',
		});
		await expect(providers.environment('opencode', 'hy4')).resolves.toEqual({
			ANTHROPIC_BASE_URL: 'http://127.0.0.1:4100/opencode',
			ANTHROPIC_AUTH_TOKEN: 'local-token',
			ANTHROPIC_MODEL: 'hy4',
			ANTHROPIC_DEFAULT_OPUS_MODEL: 'hy4',
			ANTHROPIC_DEFAULT_SONNET_MODEL: 'hy4',
			ANTHROPIC_DEFAULT_HAIKU_MODEL: 'hy4',
			CLAUDE_CODE_SUBAGENT_MODEL: 'hy4',
		});
		providers.delete('opencode');
		expect(openCodePlan(providers)).toBeNull();
	});

	it('keeps a key whose plan OpenCode would not say, and checks it again later', async () => {
		const db = openMigratedDatabase(':memory:');
		let detected: ProviderPlan | null = null;
		const providers = new ProviderKeys(
			db,
			async () => cipher(),
			async () => detected,
		);
		await providers.save('opencode', 'oc_sk_test');
		expect(providers.list().find((provider) => provider.id === 'opencode')).toMatchObject({
			keySaved: true,
			plan: null,
		});
		detected = 'go';
		await providers.checkPlan('opencode');
		expect(openCodePlan(providers)).toBe('go');
	});

	it('checks the stored key again, and adopts the plan of a key saved before plans existed', async () => {
		const db = openMigratedDatabase(':memory:');
		let detected: ProviderPlan = 'console';
		const providers = new ProviderKeys(
			db,
			async () => cipher(),
			async () => detected,
		);
		await providers.save('opencode', 'oc_sk_test');
		expect(openCodePlan(providers)).toBe('console');

		detected = 'go';
		await providers.checkPlan('opencode');
		expect(openCodePlan(providers)).toBe('go');

		expect(setProviderKey(db, 'opencode', Buffer.from('sealed:oc_sk_test'), null)).toBe(true);
		expect(openCodePlan(providers)).toBeNull();
		detected = 'console';
		await providers.detectMissingPlan();
		expect(openCodePlan(providers)).toBe('console');
	});

	it('keeps the plan of a key saved while an older key was still being checked', async () => {
		const db = openMigratedDatabase(':memory:');
		const plans: Record<string, ProviderPlan> = { oc_sk_old: 'console', oc_sk_new: 'go' };
		let release = (): void => undefined;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		let holdOld = false;
		const providers = new ProviderKeys(
			db,
			async () => cipher(),
			async (key) => {
				if (key === 'oc_sk_old' && holdOld) await held;
				return plans[key] ?? null;
			},
		);
		await providers.save('opencode', 'oc_sk_old');
		holdOld = true;
		const checking = providers.checkPlan('opencode');
		await providers.save('opencode', 'oc_sk_new');
		release();
		await checking;
		expect(openCodePlan(providers)).toBe('go');
	});

	it('asks OpenCode about a key it would not place at most once an hour', async () => {
		const db = openMigratedDatabase(':memory:');
		let clock = 0;
		let probes = 0;
		const providers = new ProviderKeys(
			db,
			async () => cipher(),
			async () => {
				probes += 1;
				return null;
			},
			undefined,
			() => clock,
		);
		await providers.save('opencode', 'oc_sk_test');
		await providers.detectMissingPlan();
		await providers.detectMissingPlan();
		expect(probes).toBe(1);

		clock += 60 * 60 * 1000;
		await providers.detectMissingPlan();
		await providers.detectMissingPlan();
		expect(probes).toBe(2);

		await providers.checkPlan('opencode');
		expect(probes).toBe(3);
	});

	it('keeps the old key when OpenCode refuses a new one', async () => {
		const providers = keys(async () => {
			throw new Error('OpenCode did not accept this key.');
		});
		await expect(providers.save('opencode', 'oc_sk_bad')).rejects.toThrow(
			'OpenCode did not accept this key.',
		);
		expect(providers.list().find((provider) => provider.id === 'opencode')).toMatchObject({
			keySaved: false,
			plan: null,
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
		await expect(providers.upstream('deepseek')).rejects.toThrow(
			'DeepSeek needs an API key. Add it in Settings, then try again.',
		);
		await expect(providers.upstream('chatgpt')).rejects.toThrow('Unknown provider `chatgpt`');
	});

	it('refuses Claude, the hidden Go catalog, an unknown provider, and an empty key', async () => {
		const providers = keys();
		await expect(providers.save('claude', 'sk-test')).rejects.toThrow('Unknown provider `claude`');
		await expect(providers.save('opencode-go', 'sk-test')).rejects.toThrow(
			'Unknown provider `opencode-go`',
		);
		await expect(providers.save('missing', 'sk-test')).rejects.toThrow(
			'Unknown provider `missing`',
		);
		await expect(providers.save('deepseek', '   ')).rejects.toThrow('The API key is not valid.');
	});
});
