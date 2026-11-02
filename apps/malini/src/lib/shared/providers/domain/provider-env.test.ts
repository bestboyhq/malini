import { describe, expect, it } from 'vitest';
import { providerEnvironment } from './provider-env';

describe('providerEnvironment', () => {
	it('points Claude Code at an Anthropic-compatible provider', () => {
		expect(
			providerEnvironment({
				name: 'DeepSeek',
				kind: 'anthropic',
				baseUrl: 'https://api.deepseek.com/anthropic',
				apiKey: 'sk-test',
				model: 'deepseek-v4-pro',
				subagentModel: 'deepseek-flash',
			}),
		).toEqual({
			ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
			ANTHROPIC_AUTH_TOKEN: 'sk-test',
			ANTHROPIC_MODEL: 'deepseek-v4-pro',
			ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-pro',
			ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-pro',
			ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-pro',
			CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-flash',
		});
	});

	it('leaves Claude on OAuth with no environment of its own', () => {
		expect(
			providerEnvironment({
				name: 'Claude',
				kind: 'claude',
				baseUrl: null,
				apiKey: null,
				model: 'opus',
				subagentModel: null,
			}),
		).toEqual({});
	});

	it('uses the main model for subagents when none is named', () => {
		expect(
			providerEnvironment({
				name: 'DeepSeek',
				kind: 'anthropic',
				baseUrl: 'https://api.deepseek.com/anthropic',
				apiKey: 'sk-test',
				model: 'deepseek-flash',
				subagentModel: null,
			})['CLAUDE_CODE_SUBAGENT_MODEL'],
		).toBe('deepseek-flash');
	});

	it('refuses a provider with no key and names where to add it', () => {
		expect(() =>
			providerEnvironment({
				name: 'DeepSeek',
				kind: 'anthropic',
				baseUrl: 'https://api.deepseek.com/anthropic',
				apiKey: null,
				model: 'deepseek-v4-pro',
				subagentModel: 'deepseek-flash',
			}),
		).toThrow('DeepSeek needs an API key. Add it in Settings, then try again.');
	});
});
