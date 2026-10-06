import { describe, expect, it } from 'vitest';
import {
	catalogModelLabel,
	effortsForModel,
	modelLabel,
	normalizeReasoningEffort,
	pickerModels,
} from './model-catalog';

const catalog = [
	{ id: 'haiku', label: 'Haiku', description: 'Fastest', efforts: [] },
	{ id: 'default', label: 'Default', description: 'Recommended', efforts: ['low', 'high'] },
	{ id: 'opus[1m]', label: 'Opus', description: 'Opus with 1M context', efforts: ['low', 'max'] },
] as const satisfies Parameters<typeof pickerModels>[0];

describe('Claude Code model catalog', () => {
	it('names aliases and full model ids the way people say them', () => {
		expect(modelLabel('default')).toBe('Default');
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

	it('lists the default first and keeps a chat model the catalog no longer reports', () => {
		expect(pickerModels(catalog, 'default').map((model) => model.id)).toEqual([
			'default',
			'opus[1m]',
			'haiku',
		]);
		expect(pickerModels(catalog, 'claude-sonnet-4-6').map((model) => model.label)).toEqual([
			'Default',
			'Opus',
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
});
