import { describe, expect, it } from 'vitest';
import { savedSecretsPrompt } from './saved-secrets';

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
