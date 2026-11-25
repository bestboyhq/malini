import { describe, expect, it } from 'vitest';
import { modelsDevModels, modelsDevVersions } from './models-dev';

function model(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id,
		name: id.toUpperCase(),
		tool_call: true,
		reasoning: true,
		reasoning_options: [{ type: 'effort', values: ['none', 'low', 'high', 'max'] }],
		modalities: { input: ['text'], output: ['text'] },
		limit: { context: 1_048_576, output: 131_072 },
		cost: { input: 1, output: 2 },
		release_date: '2026-08-01',
		...extra,
	};
}

const catalog = {
	opencode: {
		id: 'opencode',
		models: {
			'glm-5.3': model('glm-5.3', { name: 'GLM-5.3', release_date: '2026-08-14' }),
			'kimi-k3': model('kimi-k3', {
				name: 'Kimi K3',
				release_date: '2026-10-23',
				modalities: { input: ['text', 'image', 'video'], output: ['text'] },
				limit: { context: 262_144 },
				reasoning_options: [{ type: 'toggle' }],
			}),
			'minimax-m2.7': model('minimax-m2.7', { status: 'deprecated' }),
			'beam-free': model('beam-free', { cost: { input: 0, output: 0 } }),
			'no-tools': model('no-tools', { tool_call: false }),
			'image-out': model('image-out', { modalities: { input: ['text'], output: ['image'] } }),
			'Bad Id!': model('Bad Id!'),
			'plain-chat': model('plain-chat', { reasoning: false }),
			'served-anthropic': model('served-anthropic', {
				release_date: '2026-07-01',
				provider: {
					npm: '@ai-sdk/anthropic',
					api: 'https://opencode.ai/inference/anthropic/v1',
				},
			}),
			'served-openai': model('served-openai', {
				provider: { api: 'https://opencode.ai/inference/openai/v1' },
			}),
		},
	},
};

describe('models.dev catalog', () => {
	it('keeps paid tool-calling text models whichever API serves them, newest first', () => {
		expect(modelsDevModels(catalog, 'opencode')).toEqual([
			{
				id: 'kimi-k3',
				label: 'Kimi K3',
				description: 'Text and images, 262K context',
				efforts: [],
				released: '2026-10-23',
			},
			{
				id: 'glm-5.3',
				label: 'GLM-5.3',
				description: 'Text only, 1M context',
				efforts: ['low', 'high', 'max'],
				released: '2026-08-14',
			},
			{
				id: 'plain-chat',
				label: 'PLAIN-CHAT',
				description: 'Text only, 1M context',
				efforts: [],
				released: '2026-08-01',
			},
			{
				id: 'served-openai',
				label: 'SERVED-OPENAI',
				description: 'Text only, 1M context',
				efforts: ['low', 'high', 'max'],
				released: '2026-08-01',
			},
			{
				id: 'served-anthropic',
				label: 'SERVED-ANTHROPIC',
				description: 'Text only, 1M context',
				efforts: ['low', 'high', 'max'],
				released: '2026-07-01',
			},
		]);
	});

	it('keeps free models only for OpenCode Go, whose plan runs them', () => {
		const go = { 'opencode-go': catalog.opencode };
		expect(modelsDevModels(go, 'opencode-go').map(({ id }) => id)).toContain('beam-free');
		expect(modelsDevModels(catalog, 'opencode').map(({ id }) => id)).not.toContain('beam-free');
	});

	it('keeps every version newest first, under the name people use', () => {
		const families = {
			opencode: {
				models: {
					'claude-opus-5-5': model('claude-opus-5-5', {
						name: 'Claude Opus 5.5',
						family: 'claude-opus',
						release_date: '2026-09-22',
					}),
					'claude-opus-4-8': model('claude-opus-4-8', {
						name: 'Claude Opus 4.8',
						family: 'claude-opus',
						release_date: '2026-05-01',
					}),
					'deepseek-flash': model('deepseek-flash', {
						name: 'DeepSeek V4.1 Flash 1017',
						family: 'deepseek-flash',
						release_date: '2026-10-17',
					}),
					'deepseek-v4-flash': model('deepseek-v4-flash', {
						name: 'DeepSeek V4 Flash',
						family: 'deepseek-flash',
						release_date: '2026-06-01',
					}),
				},
			},
		};
		expect(
			modelsDevModels(families, 'opencode').map(({ id, label, family }) => ({ id, label, family })),
		).toEqual([
			{ id: 'deepseek-flash', label: 'DeepSeek V4.1 Flash', family: 'deepseek-flash' },
			{ id: 'claude-opus-5-5', label: 'Opus 5.5', family: 'claude-opus' },
			{ id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', family: 'deepseek-flash' },
			{ id: 'claude-opus-4-8', label: 'Opus 4.8', family: 'claude-opus' },
		]);
	});

	it('gives each model line of a family its own family, so a newer line never hides another', () => {
		const lines = {
			opencode: {
				models: {
					'nova-4-ember': model('nova-4-ember', {
						name: 'Nova 4 Ember',
						family: 'nova',
						release_date: '2026-11-18',
					}),
					'nova-4-frost': model('nova-4-frost', {
						name: 'Nova 4 Frost',
						family: 'nova',
						release_date: '2026-11-12',
					}),
					'nova-3.9-frost': model('nova-3.9-frost', {
						name: 'Nova 3.9 Frost',
						family: 'nova',
						release_date: '2026-09-01',
					}),
					'nova-4-flash': model('nova-4-flash', {
						name: 'Nova 4 Flash',
						family: 'nova-flash',
						release_date: '2026-11-10',
					}),
					'zen5-preview': model('zen5-preview', {
						name: 'Zen5 Preview',
						family: 'zen',
						release_date: '2026-11-20',
					}),
					zen4: model('zen4', { name: 'Zen4', family: 'zen', release_date: '2026-10-01' }),
				},
			},
		};
		expect(
			modelsDevModels(lines, 'opencode').map(({ id, label, family }) => ({ id, label, family })),
		).toEqual([
			{ id: 'zen5-preview', label: 'Zen5 Preview', family: 'zen' },
			{ id: 'nova-4-ember', label: 'Nova 4 Ember', family: 'nova-ember' },
			{ id: 'nova-4-frost', label: 'Nova 4 Frost', family: 'nova-frost' },
			{ id: 'nova-4-flash', label: 'Nova 4 Flash', family: 'nova-flash' },
			{ id: 'zen4', label: 'Zen4', family: 'zen' },
			{ id: 'nova-3.9-frost', label: 'Nova 3.9 Frost', family: 'nova-frost' },
		]);
	});

	it('keeps every dated version once, newest first, under its undated alias', () => {
		const anthropic = {
			anthropic: {
				models: {
					'claude-opus-4-5-20251101': model('claude-opus-4-5-20251101', {
						name: 'Claude Opus 4.5',
						family: 'claude-opus',
						release_date: '2025-11-24',
					}),
					'claude-opus-4-5': model('claude-opus-4-5', {
						name: 'Claude Opus 4.5 (latest)',
						family: 'claude-opus',
						release_date: '2025-11-24',
					}),
					'claude-opus-4-8': model('claude-opus-4-8', {
						name: 'Claude Opus 4.8',
						family: 'claude-opus',
						release_date: '2026-05-28',
					}),
					'claude-sonnet-4-5': model('claude-sonnet-4-5', { status: 'deprecated' }),
					'claude-undated': model('claude-undated', { release_date: undefined }),
				},
			},
		};
		expect(
			modelsDevVersions(anthropic, 'anthropic').map(({ id, label, family, released }) => ({
				id,
				label,
				family,
				released,
			})),
		).toEqual([
			{ id: 'claude-opus-4-8', label: 'Opus 4.8', family: 'claude-opus', released: '2026-05-28' },
			{ id: 'claude-opus-4-5', label: 'Opus 4.5', family: 'claude-opus', released: '2025-11-24' },
		]);
	});

	it('reads nothing from a provider it does not list or a catalog it cannot read', () => {
		expect(modelsDevModels(catalog, 'deepseek')).toEqual([]);
		expect(modelsDevModels(null, 'opencode')).toEqual([]);
		expect(modelsDevModels({ opencode: { models: [] } }, 'opencode')).toEqual([]);
	});
});
