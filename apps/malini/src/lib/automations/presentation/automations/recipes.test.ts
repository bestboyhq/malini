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
			then: null,
		});
	});

	it('moves opening a draft PR or queueing the merge into the automation that runs next', () => {
		const draft = draftFromWords('When a pull request merges, update the docs and open a draft PR');
		expect(draft.steps).toEqual(['Update the docs']);
		expect(draft.then).toBe('open-draft');
		expect(draftFromWords('Fix the flaky test, then queue the merge')).toMatchObject({
			steps: ['Fix the flaky test'],
			then: 'merge',
		});
	});

	it('reads then as a step break', () => {
		expect(draftFromWords('run lint, then run the tests near the changed files').steps).toEqual([
			'Run lint',
			'Run the tests near the changed files',
		]);
	});

	it('ends the trigger clause at a colon and reads each sentence as a step', () => {
		expect(
			draftFromWords(
				'When I run it: run `sleep 60 && echo suite-done` in the background. Wait for it to finish, then report what it printed.',
			),
		).toMatchObject({
			lead: 'When I run it',
			steps: [
				'Run `sleep 60 && echo suite-done` in the background',
				'Wait for it to finish',
				'Report what it printed',
			],
		});
	});
});

describe('recipe steps', () => {
	it('drafts a recipe from its own steps', () => {
		const changelog = RECIPES.find((recipe) => recipe.id === 'changelog');
		const draft = draftFromWords(changelog?.sentence ?? '');
		expect(draft).toMatchObject({ name: 'Update CHANGELOG.md', then: 'open-draft' });
		expect(draft.steps).toEqual(changelog?.steps);
	});
});

describe('guessTriggerId', () => {
	it('guesses the trigger of every recipe from its sentence', () => {
		for (const recipe of RECIPES) expect(guessTriggerId(recipe.sentence)).toBe(recipe.triggerId);
	});
});
