import { describe, expect, it } from 'vitest';
import { RECIPES, draftFromWords, guessTriggerId } from './recipes';

describe('draftFromWords', () => {
	it('splits the work into steps and keeps the trigger clause', () => {
		expect(
			draftFromWords(
				'When a pull request merges, record what changed with Grip and post the link to Slack',
			),
		).toEqual({
			name: 'Record what changed',
			lead: 'When a pull request merges',
			steps: ['Record what changed with Grip', 'Post the link to Slack'],
			output: null,
		});
	});

	it('moves opening a draft PR into what happens after', () => {
		const draft = draftFromWords(
			'When a pull request merges, update CHANGELOG.md and open a draft PR',
		);
		expect(draft.steps).toEqual(['Update CHANGELOG.md']);
		expect(draft.output).toBe('draft');
	});

	it('reads then as a step break', () => {
		expect(draftFromWords('run lint, then run the tests near the changed files').steps).toEqual([
			'Run lint',
			'Run the tests near the changed files',
		]);
	});
});

describe('guessTriggerId', () => {
	it('guesses the trigger of every recipe from its sentence', () => {
		for (const recipe of RECIPES) expect(guessTriggerId(recipe.sentence)).toBe(recipe.triggerId);
	});
});
