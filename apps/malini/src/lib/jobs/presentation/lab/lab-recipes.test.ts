import { describe, expect, it } from 'vitest';
import { LAB_RECIPES, labDraft, labGuessTriggerId } from './lab-recipes';

describe('labDraft', () => {
	it('splits the work into steps, finds tools, and keeps the trigger clause', () => {
		expect(
			labDraft(
				'When a pull request merges, record what changed with Grip and post the link to Slack',
			),
		).toEqual({
			name: 'Record what changed',
			lead: 'When a pull request merges',
			steps: ['Record what changed with Grip', 'Post the link to Slack'],
			output: null,
			tools: ['Grip', 'Slack'],
		});
	});

	it('moves opening a draft PR into what happens after', () => {
		const draft = labDraft('When a pull request merges, update CHANGELOG.md and open a draft PR');
		expect(draft.steps).toEqual(['Update CHANGELOG.md']);
		expect(draft.output).toBe('draft');
	});

	it('reads then as a step break', () => {
		expect(labDraft('run lint, then run the tests near the changed files').steps).toEqual([
			'Run lint',
			'Run the tests near the changed files',
		]);
	});
});

describe('labGuessTriggerId', () => {
	it('guesses the trigger of every recipe from its sentence', () => {
		for (const recipe of LAB_RECIPES)
			expect(labGuessTriggerId(recipe.sentence)).toBe(recipe.triggerId);
	});
});
