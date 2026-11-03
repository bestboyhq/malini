import { describe, expect, it } from 'vitest';
import { modelsDevModels } from './models-dev';

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
			},
			{
				id: 'glm-5.3',
				label: 'GLM-5.3',
				description: 'Text only, 1M context',
				efforts: ['low', 'high', 'max'],
			},
			{ id: 'plain-chat', label: 'PLAIN-CHAT', description: 'Text only, 1M context', efforts: [] },
			{
				id: 'served-openai',
				label: 'SERVED-OPENAI',
				description: 'Text only, 1M context',
				efforts: ['low', 'high', 'max'],
			},
			{
				id: 'served-anthropic',
				label: 'SERVED-ANTHROPIC',
				description: 'Text only, 1M context',
				efforts: ['low', 'high', 'max'],
			},
		]);
	});

	it('reads nothing from a provider it does not list or a catalog it cannot read', () => {
		expect(modelsDevModels(catalog, 'deepseek')).toEqual([]);
		expect(modelsDevModels(null, 'opencode')).toEqual([]);
		expect(modelsDevModels({ opencode: { models: [] } }, 'opencode')).toEqual([]);
	});
});
