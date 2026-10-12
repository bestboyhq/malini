import { describe, expect, it } from 'vitest';
import {
	MAX_REMEMBERED_CLAUDE_ACCOUNTS,
	normalizeRememberedClaudeAccounts,
	otherClaudeAccounts,
	rememberClaudeAccount,
} from './claude-accounts';

describe('remembered Claude accounts', () => {
	it('keeps the latest account first, once, and offers every other one to switch to', () => {
		const once = rememberClaudeAccount([], 'me@private.dev');
		const twice = rememberClaudeAccount(once, 'me@work.dev');
		const back = rememberClaudeAccount(twice, 'me@private.dev');

		expect(back).toEqual(['me@private.dev', 'me@work.dev']);
		expect(otherClaudeAccounts(back, 'me@private.dev')).toEqual(['me@work.dev']);
		expect(otherClaudeAccounts(back, null)).toEqual(back);
	});

	it('remembers only a handful of accounts', () => {
		const many = Array.from({ length: 8 }, (_, index) => `me${index}@example.com`).reduce<string[]>(
			(remembered, email) => rememberClaudeAccount(remembered, email),
			[],
		);

		expect(many).toHaveLength(MAX_REMEMBERED_CLAUDE_ACCOUNTS);
		expect(many[0]).toBe('me7@example.com');
	});

	it('reads back only email addresses from storage, in their order', () => {
		expect(normalizeRememberedClaudeAccounts(null)).toEqual([]);
		expect(
			normalizeRememberedClaudeAccounts(['a@x.dev', 42, 'not-an-email', 'b@x.dev', 'a@x.dev']),
		).toEqual(['a@x.dev', 'b@x.dev']);
	});
});
