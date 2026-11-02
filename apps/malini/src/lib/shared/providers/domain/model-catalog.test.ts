import { describe, expect, it } from 'vitest';
import {
	catalogModelLabel,
	effortsForModel,
	filterPickerModels,
	modelDescription,
	modelLabel,
	normalizeReasoningEffort,
	pickerModels,
} from './model-catalog';

const catalog = [
	{ id: 'haiku', label: 'Haiku', description: 'Fastest', efforts: [] },
	{ id: 'sonnet', label: 'Sonnet', description: 'Routine', efforts: ['low', 'high'] },
	{ id: 'opus[1m]', label: 'Opus', description: 'Opus with 1M context', efforts: ['low', 'max'] },
] as const satisfies Parameters<typeof pickerModels>[0];

describe('Claude Code model catalog', () => {
	it("describes a model by its family in Malini's words, and keeps another model's own", () => {
		const copyFor = (id: string, description = 'From the provider') =>
			modelDescription({ id, label: id, description, efforts: [] });
		expect(copyFor('opus')).toBe('Does the real work. Usually right');
		expect(copyFor('opus[1m]')).toBe('Does the real work. Usually right');
		expect(copyFor('claude-haiku-5-5')).toBe("Fast. Don't ask it to ponder");
		expect(copyFor('deepseek-flash')).toBe('Quick, and it can see');
		expect(copyFor('kimi-k3')).toBe('From the provider');
		expect(copyFor('kimi-k3', '')).toBe('');
	});

	it('names aliases and full model ids the way people say them', () => {
		expect(modelLabel('opus[1m]')).toBe('Opus 1M');
		expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5');
		expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
		expect(catalogModelLabel(catalog, 'opus[1m]')).toBe('Opus');
		expect(
			catalogModelLabel(
				[{ ...catalog[0], id: 'claude-opus-5', label: 'claude-opus-5' }],
				'claude-opus-5',
			),
		).toBe('Opus 5');
	});

	it('lists models by family and keeps a chat model the catalog no longer reports', () => {
		expect(pickerModels(catalog, 'sonnet').map((model) => model.id)).toEqual([
			'opus[1m]',
			'sonnet',
			'haiku',
		]);
		expect(pickerModels(catalog, 'claude-sonnet-4-6').map((model) => model.label)).toEqual([
			'Opus',
			'Sonnet',
			'Sonnet 4.6',
			'Haiku',
		]);
	});

	it('offers only the efforts a model supports and falls back to the nearest one', () => {
		expect(effortsForModel(catalog, 'haiku')).toEqual([]);
		expect(effortsForModel(catalog, 'unknown')).toContain('max');
		expect(normalizeReasoningEffort(['low', 'high'], 'medium')).toBe('high');
		expect(normalizeReasoningEffort(['low', 'max'], 'medium')).toBe('max');
		expect(normalizeReasoningEffort([], 'medium')).toBe('medium');
	});

	it('filters picker rows by every word across model name, id and provider', () => {
		const rows = [
			{ provider: 'claude', providerName: 'Claude', model: catalog[1] },
			{
				provider: 'opencode-go',
				providerName: 'OpenCode Go',
				model: { id: 'glm-5.3', label: 'GLM-5.3', description: '', efforts: [] },
			},
			{
				provider: 'deepseek',
				providerName: 'DeepSeek',
				model: { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', description: '', efforts: [] },
			},
		];
		expect(filterPickerModels(rows, '  ')).toBe(rows);
		expect(filterPickerModels(rows, 'GLM').map((row) => row.model.id)).toEqual(['glm-5.3']);
		expect(filterPickerModels(rows, 'go 5.3').map((row) => row.model.id)).toEqual(['glm-5.3']);
		expect(filterPickerModels(rows, 'deepseek pro').map((row) => row.provider)).toEqual([
			'deepseek',
		]);
		expect(filterPickerModels(rows, 'kimi')).toEqual([]);
	});
});
