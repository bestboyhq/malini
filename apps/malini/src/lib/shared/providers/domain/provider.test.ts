import { describe, expect, it } from 'vitest';
import { modelAccess, type ProviderGroup } from './provider';

const groups: readonly ProviderGroup[] = [
	{
		id: 'claude',
		name: 'Claude',
		kind: 'claude',
		baseUrl: null,
		models: [],
		ready: true,
		message: '',
	},
	{
		id: 'deepseek',
		name: 'DeepSeek',
		kind: 'anthropic',
		baseUrl: 'https://api.deepseek.com/anthropic',
		models: [],
		ready: false,
		message: '',
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
});
