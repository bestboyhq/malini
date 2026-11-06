import { describe, expect, it } from 'vitest';
import {
	catalogModelLabel,
	effortsForModel,
	filterPickerRows,
	modelLabel,
	normalizeReasoningEffort,
	pickerRows,
	rowRunner,
	selectionLabel,
	type AgentModelInfo,
} from './model-catalog';
import type { ProviderGroup } from './provider';

const catalog = [
	{ id: 'haiku', label: 'Haiku', description: 'Fastest', efforts: [] },
	{ id: 'sonnet', label: 'Sonnet', description: 'Routine', efforts: ['low', 'high'] },
	{ id: 'opus[1m]', label: 'Opus', description: 'Opus with 1M context', efforts: ['low', 'max'] },
] as const satisfies readonly AgentModelInfo[];

function model(id: string, label = id, family?: string): AgentModelInfo {
	return {
		id,
		label,
		description: `${label} from the provider`,
		efforts: [],
		...(family ? { family } : {}),
	};
}

function group(
	id: string,
	ready: boolean,
	models: AgentModelInfo[],
	kind: ProviderGroup['kind'] = 'anthropic',
): ProviderGroup {
	return {
		id,
		name: id.toUpperCase(),
		kind,
		baseUrl: null,
		ready,
		message: '',
		models,
		plan: null,
	};
}

const groups = [
	group(
		'claude',
		true,
		[model('opus', 'Opus 4.8'), model('opus[1m]'), model('haiku', 'Haiku 5.5')],
		'claude',
	),
	group('deepseek', true, [model('deepseek-flash', 'DeepSeek V4.1 Flash', 'deepseek-flash')]),
	group('opencode', false, [
		model('gpt-6.1-sol', 'GPT-6.1 Sol', 'gpt-sol'),
		model('claude-fable-5-1', 'Fable 5.1', 'claude-fable'),
		model('claude-opus-5-5', 'Opus 5.5', 'claude-opus'),
		model('deepseek-v4.1-flash', 'DeepSeek V4.1 Flash', 'deepseek-flash'),
		model('gpt-6-sol', 'GPT-6 Sol', 'gpt-sol'),
	]),
];

const shape = (rows: ReturnType<typeof pickerRows>) =>
	rows.map((row) => `${row.label}: ${row.runners.map((runner) => runner.group.id).join(' ')}`);

describe('Claude Code model catalog', () => {
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

	it('offers only the efforts a model supports and falls back to the nearest one', () => {
		expect(effortsForModel(catalog, 'haiku')).toEqual([]);
		expect(effortsForModel(catalog, 'unknown')).toContain('max');
		expect(normalizeReasoningEffort(['low', 'high'], 'medium')).toBe('high');
		expect(normalizeReasoningEffort(['low', 'max'], 'medium')).toBe('max');
		expect(normalizeReasoningEffort([], 'medium')).toBe('medium');
	});
});

describe('model picker rows', () => {
	const selection = { provider: 'claude', model: 'opus' };

	it('lists each model family once, with every provider that runs it, Claude families first', () => {
		expect(shape(pickerRows(groups, selection))).toEqual([
			'Opus 5.5: claude opencode',
			'Fable 5.1: opencode',
			'Haiku 5.5: claude',
			'DeepSeek V4.1 Flash: deepseek opencode',
			'GPT-6.1 Sol: opencode',
		]);
	});

	it("describes a family in Malini's words and keeps another model's own", () => {
		const lines = pickerRows(groups, selection).map((row) => row.description);
		expect(lines).toEqual([
			'Does the real work. Usually right',
			'For problems that fight back',
			"Fast. Don't ask it to ponder",
			'Quick, and it can see',
			'GPT-6.1 Sol from the provider',
		]);
	});

	it('keeps a selection the list no longer shows right after its family', () => {
		const older = { provider: 'opencode', model: 'gpt-6-sol' };
		expect(shape(pickerRows(groups, older)).slice(4)).toEqual([
			'GPT-6.1 Sol: opencode',
			'GPT-6 Sol: opencode',
		]);
		expect(shape(pickerRows(groups, { provider: 'gone', model: 'claude-opus-4-1' })).at(-1)).toBe(
			'Opus 4.1: gone',
		);
	});

	it('runs a row on the selected provider, else the first ready one, else the first', () => {
		const rows = pickerRows(groups, selection);
		const ready = (runner: { group: ProviderGroup }) => runner.group.ready;
		const runnerOf = (label: string, current = selection) => {
			const row = rows.find((candidate) => candidate.label === label);
			return row ? rowRunner(row, current, ready).group.id : null;
		};
		expect(runnerOf('Opus 5.5')).toBe('claude');
		expect(runnerOf('Opus 5.5', { provider: 'opencode', model: 'claude-opus-5-5' })).toBe(
			'opencode',
		);
		expect(runnerOf('DeepSeek V4.1 Flash')).toBe('deepseek');
		expect(runnerOf('GPT-6.1 Sol')).toBe('opencode');
	});

	it('names the selection by its row, the same for every provider that runs it', () => {
		expect(selectionLabel(groups, selection)).toBe('Opus 5.5');
		expect(selectionLabel(groups, { provider: 'opencode', model: 'claude-opus-5-5' })).toBe(
			'Opus 5.5',
		);
		expect(selectionLabel(groups, { provider: 'claude', model: 'opus[1m]' })).toBe('Opus 1M');
	});

	it('filters rows by every word across model name, id and provider', () => {
		const rows = pickerRows(groups, selection);
		expect(filterPickerRows(rows, '  ')).toBe(rows);
		expect(shape(filterPickerRows(rows, 'sol'))).toEqual(['GPT-6.1 Sol: opencode']);
		expect(shape(filterPickerRows(rows, 'deepseek opencode'))).toEqual([
			'DeepSeek V4.1 Flash: deepseek opencode',
		]);
		expect(shape(filterPickerRows(rows, 'claude haiku'))).toEqual(['Haiku 5.5: claude']);
		expect(filterPickerRows(rows, 'kimi')).toEqual([]);
	});
});
