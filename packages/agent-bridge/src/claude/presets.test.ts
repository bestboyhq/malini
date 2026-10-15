import { describe, expect, it } from 'vitest';
import { cleanPresetSuggestions } from './presets.js';

const SKILLS = [
	'animate',
	'css-animations',
	'humanizer',
	'landing-arch',
	'ponytail:ponytail',
	'adr',
];

describe('cleanPresetSuggestions', () => {
	it('keeps known skills, resolves a plugin skill by its short name, and trims names', () => {
		expect(
			cleanPresetSuggestions(
				{
					presets: [
						{ name: ' Motion  designer ', skills: ['animate', 'css-animations', 'animate'] },
						{ name: 'Builder', skills: ['ponytail', 'adr', 'made-up'] },
					],
				},
				SKILLS,
			),
		).toEqual([
			{ name: 'Motion designer', skills: ['animate', 'css-animations'] },
			{ name: 'Builder', skills: ['ponytail:ponytail', 'adr'] },
		]);
	});

	it('drops presets with fewer than two known skills, repeated names, and malformed output', () => {
		expect(
			cleanPresetSuggestions(
				{
					presets: [
						{ name: 'Marketer', skills: ['humanizer', 'landing-arch'] },
						{ name: 'marketer', skills: ['humanizer', 'animate'] },
						{ name: 'Writer', skills: ['humanizer', 'unknown'] },
						{ name: '', skills: ['animate', 'adr'] },
						{ name: 'Broken', skills: 'animate' },
						'Designer',
					],
				},
				SKILLS,
			),
		).toEqual([{ name: 'Marketer', skills: ['humanizer', 'landing-arch'] }]);
		expect(cleanPresetSuggestions(null, SKILLS)).toEqual([]);
		expect(cleanPresetSuggestions({ presets: 'Builder' }, SKILLS)).toEqual([]);
	});

	it('leaves a short name unresolved when two plugins share it', () => {
		expect(
			cleanPresetSuggestions(
				{ presets: [{ name: 'Builder', skills: ['review', 'adr', 'animate'] }] },
				['a:review', 'b:review', 'adr', 'animate'],
			),
		).toEqual([{ name: 'Builder', skills: ['adr', 'animate'] }]);
	});
});
