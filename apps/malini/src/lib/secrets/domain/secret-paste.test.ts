import { describe, expect, it } from 'vitest';
import { pastedSecrets } from './secret-paste';

const ASKED = ['STRIPE_KEY', 'SENDGRID_KEY', 'SENTRY_DSN', 'PRIVATE_KEY'];

describe('pastedSecrets', () => {
	it('takes what a pasted .env block assigns to the asked names', () => {
		const pasted = [
			'# Stripe',
			'export STRIPE_KEY="sk_live_51abc"',
			"SENDGRID_KEY='SG.x#y'",
			'SENTRY_DSN=https://dsn.example/1 # production',
			'GITHUB_TOKEN=ghp_not_asked',
			'PRIVATE_KEY="-----BEGIN KEY-----',
			'abc',
			'-----END KEY-----"',
		].join('\r\n');

		expect(pastedSecrets(pasted, ASKED)).toEqual({
			STRIPE_KEY: 'sk_live_51abc',
			SENDGRID_KEY: 'SG.x#y',
			SENTRY_DSN: 'https://dsn.example/1',
		});
	});

	it('reads YAML and JSON pairs and expands \\n in double quotes', () => {
		const pasted = 'STRIPE_KEY: sk_live_1\n  "SENDGRID_KEY": "SG.2",\nPRIVATE_KEY="a\\nb"';

		expect(pastedSecrets(pasted, ASKED)).toEqual({
			STRIPE_KEY: 'sk_live_1',
			SENDGRID_KEY: 'SG.2',
			PRIVATE_KEY: 'a\nb',
		});
	});

	it('finds nothing in a bare value, even one with = in it', () => {
		expect(pastedSecrets('sk_live_51abc', ASKED)).toEqual({});
		expect(pastedSecrets('DefaultEndpointsProtocol=https;AccountKey=abc==', ASKED)).toEqual({});
		expect(pastedSecrets('STRIPE_KEY=', ASKED)).toEqual({});
	});
});
