import { describe, expect, it } from 'vitest';
import type { ModelProviderRecord } from '$contract/agent';
import { modelAccess, providerGroups, type ProviderGroup } from './provider';

const groups: readonly ProviderGroup[] = [
	{
		id: 'claude',
		name: 'Claude',
		kind: 'claude',
		baseUrl: null,
		models: [],
		ready: true,
		message: '',
		account: null,
		plan: null,
	},
	{
		id: 'deepseek',
		name: 'DeepSeek',
		kind: 'anthropic',
		baseUrl: 'https://api.deepseek.com/anthropic',
		models: [],
		ready: false,
		message: '',
		account: null,
		plan: null,
	},
];

const readyClaude = { kind: 'ready', version: null, account: null } as const;

describe('model access', () => {
	it('asks for a sign-in when Claude Code is installed but signed out', () => {
		expect(
			modelAccess({ provider: 'claude', model: 'opus' }, groups, {
				kind: 'signed-out',
				version: '1.0.0',
			}),
		).toEqual({ kind: 'claude-signed-out' });
	});

	it('asks to install Claude Code when it is missing', () => {
		expect(modelAccess({ provider: 'claude', model: 'opus' }, groups, { kind: 'missing' })).toEqual(
			{ kind: 'claude-code-missing' },
		);
	});

	it('keeps send available while the Claude Code probe is still running', () => {
		expect(
			modelAccess({ provider: 'claude', model: 'opus' }, groups, { kind: 'checking' }),
		).toEqual({ kind: 'checking' });
	});

	it('asks for the provider key when the provider has none', () => {
		expect(
			modelAccess({ provider: 'deepseek', model: 'deepseek-flash' }, groups, readyClaude),
		).toEqual({ kind: 'needs-key', providerId: 'deepseek', providerName: 'DeepSeek' });
	});

	it('runs a model once its provider key is saved', () => {
		const withKey = groups.map((group) =>
			group.id === 'deepseek' ? { ...group, ready: true } : group,
		);
		expect(
			modelAccess({ provider: 'deepseek', model: 'deepseek-flash' }, withKey, readyClaude),
		).toEqual({ kind: 'ready' });
	});

	it('names an unknown provider by its id', () => {
		expect(modelAccess({ provider: 'zen', model: 'qwen' }, groups, readyClaude)).toEqual({
			kind: 'needs-key',
			providerId: 'zen',
			providerName: 'zen',
		});
	});

	it('asks for a ChatGPT sign-in, then runs only a model the plan offers', () => {
		const chatgpt: ModelProviderRecord = {
			id: 'chatgpt',
			name: 'ChatGPT',
			kind: 'chatgpt',
			baseUrl: 'https://api.openai.com/v1',
			models: [],
			keySaved: false,
			account: null,
			plan: null,
		};
		const selection = { provider: 'chatgpt', model: 'gpt-6.1-sol' };
		const signedOut = providerGroups(null, [chatgpt]);
		expect(signedOut[1]).toMatchObject({ ready: false, message: 'Sign in to ChatGPT' });
		expect(modelAccess(selection, signedOut, readyClaude)).toEqual({ kind: 'chatgpt-signed-out' });

		const account = { email: 'dev@example.com', name: null, usageLimitReachedAt: null };
		const signedIn = providerGroups(null, [{ ...chatgpt, account }]);
		expect(signedIn[1]).toMatchObject({ ready: true, account });
		expect(modelAccess(selection, signedIn, readyClaude)).toEqual({
			kind: 'chatgpt-model-missing',
		});

		const sol = { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', description: '', efforts: [] };
		const offered = providerGroups(null, [{ ...chatgpt, account, models: [sol] }]);
		expect(modelAccess(selection, offered, readyClaude)).toEqual({ kind: 'ready' });
	});
});
