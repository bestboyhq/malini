import { describe, expect, it } from 'vitest';
import { savedSecretsPrompt, savedSecretsWake } from './saved-secrets';

describe('savedSecretsPrompt', () => {
	it('tells the agent which variables are set from now on, never a value', () => {
		expect(
			savedSecretsPrompt({ names: ['STRIPE_KEY'], unsaved: [], repository: 'acme/shop' }),
		).toBe(
			'Saved STRIPE_KEY for acme/shop: $STRIPE_KEY is set in every command you run from now on, and Malini masks its value as [secret] in every output.',
		);
	});

	it('names what was left empty, for every repository', () => {
		expect(
			savedSecretsPrompt({
				names: ['STRIPE_KEY', 'SENDGRID_KEY'],
				unsaved: ['OPENAI_API_KEY'],
				repository: null,
			}),
		).toBe(
			[
				'Saved STRIPE_KEY and SENDGRID_KEY for every repository: $STRIPE_KEY and $SENDGRID_KEY are set in every command you run from now on, and Malini masks their values as [secret] in every output.',
				'OPENAI_API_KEY was left empty, so it is still not set.',
			].join('\n'),
		);
	});
});

describe('savedSecretsWake', () => {
	const saved = savedSecretsPrompt({
		names: ['STRIPE_KEY', 'SENDGRID_KEY', 'GITHUB_TOKEN'],
		unsaved: ['OPENAI_API_KEY', 'SLACK_TOKEN'],
		repository: 'acme/shop',
	});

	it('finds the names Malini told the agent about, and leaves nothing for the user to read', () => {
		expect(savedSecretsWake(saved)).toEqual({
			saved: 'STRIPE_KEY, SENDGRID_KEY and GITHUB_TOKEN',
			rest: '',
		});
	});

	it('keeps the prompts batched with it', () => {
		const prompt = savedSecretsPrompt({ names: ['DEMO_TOKEN'], unsaved: [], repository: null });
		expect(savedSecretsWake(`Ship it.\n\nThen tidy up.\n\n${prompt}`)).toEqual({
			saved: 'DEMO_TOKEN',
			rest: 'Ship it.\n\nThen tidy up.',
		});
	});

	it('leaves a prompt that only reads like one untouched', () => {
		const typed = 'Saved STRIPE_KEY for acme/shop: $STRIPE_KEY works now, right?';
		expect(savedSecretsWake(typed)).toEqual({ saved: null, rest: typed });
		expect(savedSecretsWake(`${saved}\nThanks.`)).toEqual({
			saved: null,
			rest: `${saved}\nThanks.`,
		});
	});
});
