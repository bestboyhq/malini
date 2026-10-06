import { tmpdir } from 'node:os';
import type { ModelInfo, SDKControlInitializeResponse } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FALLBACK_MODELS, probeClaudeCode, unknownCapability } from './capabilities.js';
import { fakeClaude, initializeResponse } from './fixtures/fake-claude.js';
import type { ClaudeAuthStatus } from './installation.js';

const EXECUTABLE = '/opt/claude/bin/claude';

const RECORDED_MODELS: ModelInfo[] = [
	{
		value: 'default',
		displayName: 'Default (recommended)',
		description: 'Opus 4.8 with 1M context · Best for everyday, complex tasks',
		supportsEffort: true,
		supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
	},
	{
		value: 'opus[1m]',
		displayName: 'Opus',
		description: 'Opus 4.8 with 1M context · Best for everyday, complex tasks',
		supportsEffort: true,
		supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
	},
	{
		value: 'sonnet',
		displayName: 'Sonnet',
		description: 'Sonnet 4.6 · Efficient for routine tasks',
		supportsEffort: true,
		supportedEffortLevels: ['low', 'medium', 'high', 'max'],
	},
	{ value: 'haiku', displayName: 'Haiku', description: 'Haiku 4.5 · Fastest for quick answers' },
];

const SIGNED_IN: ClaudeAuthStatus = {
	signedIn: true,
	account: { email: 'ada@example.com', plan: 'Claude Max' },
};

function installed(
	auth: ClaudeAuthStatus,
	initializationResult: () => Promise<SDKControlInitializeResponse> = async () =>
		initializeResponse(RECORDED_MODELS),
) {
	const claude = fakeClaude([], initializationResult);
	return {
		claude,
		options: {
			findExecutable: () => EXECUTABLE,
			version: async () => '2.1.196',
			authStatus: async () => auth,
			query: claude.query,
		},
	};
}

afterEach(() => {
	vi.useRealTimers();
});

describe('probeClaudeCode', () => {
	it('reports a missing installation without running anything', async () => {
		const query = vi.fn();
		const capability = await probeClaudeCode({ findExecutable: () => null, query });

		expect(capability).toEqual({
			state: 'missing',
			installed: false,
			authenticated: null,
			version: null,
			account: null,
			models: FALLBACK_MODELS,
			defaultModel: 'default',
			message: 'Claude Code is not installed',
		});
		expect(query).not.toHaveBeenCalled();
	});

	it('asks a signed-out user to sign in while still listing the models', async () => {
		const { options } = installed({ signedIn: false });

		expect(await probeClaudeCode(options)).toMatchObject({
			state: 'needs_auth',
			installed: true,
			authenticated: false,
			version: '2.1.196',
			account: null,
			models: expect.arrayContaining([expect.objectContaining({ id: 'opus[1m]' })]),
			message: 'Sign in to Claude Code to start',
		});
	});

	it('reports the signed-in account and the models Claude Code offers it', async () => {
		const { options } = installed(SIGNED_IN);

		expect(await probeClaudeCode(options)).toEqual({
			state: 'ready',
			installed: true,
			authenticated: true,
			version: '2.1.196',
			account: { email: 'ada@example.com', plan: 'Claude Max' },
			models: [
				{
					id: 'default',
					label: 'Default',
					description: 'Opus 4.8 with 1M context · Best for everyday, complex tasks',
					efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
				},
				{
					id: 'opus[1m]',
					label: 'Opus',
					description: 'Opus 4.8 with 1M context · Best for everyday, complex tasks',
					efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
				},
				{
					id: 'sonnet',
					label: 'Sonnet',
					description: 'Sonnet 4.6 · Efficient for routine tasks',
					efforts: ['low', 'medium', 'high', 'max'],
				},
				{
					id: 'haiku',
					label: 'Haiku',
					description: 'Haiku 4.5 · Fastest for quick answers',
					efforts: [],
				},
			],
			defaultModel: 'default',
			message: 'Signed in as ada@example.com',
		});
	});

	it('lists models from an isolated Claude Code that never receives a prompt', async () => {
		const { claude, options } = installed(SIGNED_IN);
		await probeClaudeCode(options);

		const [probe] = claude.runs;
		expect(probe?.options).toMatchObject({
			cwd: tmpdir(),
			pathToClaudeCodeExecutable: EXECUTABLE,
			mcpServers: {},
			strictMcpConfig: true,
			persistSession: false,
		});
		expect(await probe?.prompt).toBe('');
		expect(probe?.closed).toBe(true);
	});

	it('keeps the default model first when Claude Code does not list it', async () => {
		const { options } = installed(SIGNED_IN, async () =>
			initializeResponse(RECORDED_MODELS.filter(({ value }) => value !== 'default')),
		);

		const { models } = await probeClaudeCode(options);
		expect(models.map(({ id }) => id)).toEqual(['default', 'opus[1m]', 'sonnet', 'haiku']);
	});

	it.each([
		['fails', async () => Promise.reject(new Error('spawn EACCES'))],
		['lists no models', async () => initializeResponse([])],
	])('falls back to the built-in models when the model probe %s', async (_label, init) => {
		const { claude, options } = installed(SIGNED_IN, init);

		const capability = await probeClaudeCode(options);
		expect(capability).toMatchObject({ state: 'ready', models: FALLBACK_MODELS });
		expect(claude.runs[0]?.closed).toBe(true);
	});

	it('falls back to the built-in models when the model probe hangs', async () => {
		vi.useFakeTimers();
		const { claude, options } = installed(SIGNED_IN, async () => new Promise(() => undefined));

		const probing = probeClaudeCode(options);
		await vi.advanceTimersByTimeAsync(15_000);

		expect(await probing).toMatchObject({ state: 'ready', models: FALLBACK_MODELS });
		expect(claude.runs[0]?.closed).toBe(true);
	});

	it('still reports a ready installation when its version cannot be read', async () => {
		const { options } = installed(SIGNED_IN);

		const capability = await probeClaudeCode({
			...options,
			version: async () => Promise.reject(new Error('timed out')),
		});
		expect(capability).toMatchObject({ state: 'ready', version: null });
	});
});

describe('unknownCapability', () => {
	it('offers the built-in models while the installation state is unknown', () => {
		expect(unknownCapability('Could not check Claude Code')).toEqual({
			state: 'unknown',
			installed: true,
			authenticated: null,
			version: null,
			account: null,
			models: FALLBACK_MODELS,
			defaultModel: 'default',
			message: 'Could not check Claude Code',
		});
	});
});
