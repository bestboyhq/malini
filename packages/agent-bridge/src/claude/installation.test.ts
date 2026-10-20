import { describe, expect, it } from 'vitest';
import { parseClaudeAuthStatus } from './installation.js';

const SIGNED_IN = {
	loggedIn: true,
	authMethod: 'claude.ai',
	apiProvider: 'firstParty',
	email: 'ada@example.com',
	orgId: '00000000-0000-4000-8000-000000000000',
	orgName: "ada@example.com's Organization",
	subscriptionType: 'max',
};

describe('parseClaudeAuthStatus', () => {
	it('reads the signed-in account and names its plan', () => {
		expect(parseClaudeAuthStatus(JSON.stringify(SIGNED_IN))).toEqual({
			signedIn: true,
			account: { email: 'ada@example.com', plan: 'Claude Max' },
		});
	});

	it('keeps a plan name that already reads as a Claude plan', () => {
		expect(
			parseClaudeAuthStatus(JSON.stringify({ ...SIGNED_IN, subscriptionType: 'Claude Team' })),
		).toMatchObject({ account: { plan: 'Claude Team' } });
	});

	it('signs in without account details when Claude Code reports none', () => {
		expect(
			parseClaudeAuthStatus(
				JSON.stringify({
					loggedIn: true,
					authMethod: 'api_key',
					email: '',
					subscriptionType: null,
				}),
			),
		).toEqual({ signedIn: true, account: {} });
	});

	it.each([
		['a signed-out status', JSON.stringify({ loggedIn: false })],
		['an empty output', ''],
		['output that is not JSON', 'Not logged in. Run claude auth login'],
		['a JSON value that is not an object', '[true]'],
	])('treats %s as signed out', (_label, stdout) => {
		expect(parseClaudeAuthStatus(stdout)).toEqual({ signedIn: false });
	});
});
