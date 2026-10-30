import { describe, expect, it } from 'vitest';
import { secretGroups } from './secret-groups';

const AT = '2026-10-30T10:00:00.000Z';

describe('secretGroups', () => {
	it('puts the secrets for everywhere first, then each repository by name', () => {
		expect(
			secretGroups([
				{ name: 'STRIPE_KEY', repository: 'acme/shop', savedAt: AT },
				{ name: 'SENTRY_DSN', repository: null, savedAt: AT },
				{ name: 'GITHUB_TOKEN', repository: 'Acme/Blog', savedAt: AT },
				{ name: 'SENDGRID_KEY', repository: 'ACME/shop', savedAt: AT },
			]),
		).toEqual([
			{ repository: null, secrets: [{ name: 'SENTRY_DSN', repository: null, savedAt: AT }] },
			{
				repository: 'Acme/Blog',
				secrets: [{ name: 'GITHUB_TOKEN', repository: 'Acme/Blog', savedAt: AT }],
			},
			{
				repository: 'acme/shop',
				secrets: [
					{ name: 'STRIPE_KEY', repository: 'acme/shop', savedAt: AT },
					{ name: 'SENDGRID_KEY', repository: 'ACME/shop', savedAt: AT },
				],
			},
		]);
	});
});
