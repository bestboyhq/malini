import { describe, expect, it } from 'vitest';
import { flattenSelectOptions, isSelectOptionGroup, type SelectItem } from './options';

describe('select option groups', () => {
	const mixed: SelectItem[] = [
		{ value: '', label: 'No preference' },
		{
			label: 'Anthropic',
			options: [
				{ value: 'anthropic:opus', label: 'Opus' },
				{ value: 'anthropic:sonnet', label: 'Sonnet' },
			],
		},
		{ label: 'OpenAI', options: [{ value: 'openai:gpt-5', label: 'GPT-5' }] },
	];

	it('tells a group apart from a plain option by the options it carries', () => {
		const [plain, group] = mixed;
		expect(plain).toBeDefined();
		expect(group).toBeDefined();
		if (plain === undefined || group === undefined) throw new Error('fixture lost its entries');

		expect(isSelectOptionGroup(plain)).toBe(false);
		expect(isSelectOptionGroup(group)).toBe(true);
	});

	it('keeps an ungrouped list selectable exactly as before', () => {
		const flat: SelectItem[] = [
			{ value: 'private', label: 'Private' },
			{ value: 'team', label: 'Team' },
		];

		expect(flattenSelectOptions(flat).map((option) => option.value)).toEqual(['private', 'team']);
	});

	it('lists a mixed flat-and-grouped set in the order it renders', () => {
		expect(flattenSelectOptions(mixed).map((option) => option.value)).toEqual([
			'',
			'anthropic:opus',
			'anthropic:sonnet',
			'openai:gpt-5',
		]);
	});
});
