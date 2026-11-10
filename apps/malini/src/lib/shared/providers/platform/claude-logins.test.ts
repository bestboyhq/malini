import { describe, expect, it } from 'vitest';
import { claudeLoginStorage, parseClaudeLogin, refreshTokenEnvironment } from './claude-logins';

describe('Claude Code sign-in storage', () => {
	it('names the keychain item and file Claude Code keeps for its config folder', () => {
		expect(claudeLoginStorage({ USER: 'me' }, '/Users/me')).toEqual({
			service: 'Claude Code-credentials',
			account: 'me',
			file: '/Users/me/.claude/.credentials.json',
		});
		expect(
			claudeLoginStorage({ USER: 'me', CLAUDE_CONFIG_DIR: '/Users/me/.claude-work' }, '/Users/me'),
		).toEqual({
			service: 'Claude Code-credentials-1e91dd84',
			account: 'me',
			file: '/Users/me/.claude-work/.credentials.json',
		});
		expect(claudeLoginStorage({ USER: 'me@corp' }, '/Users/me').account).toBe('claude-code-user');
	});

	it('reads the refresh token and scopes, from JSON or the hex the keychain prints', () => {
		const stored = JSON.stringify({
			claudeAiOauth: { accessToken: 'at', refreshToken: 'rt', scopes: ['user:inference', 7] },
			mcpOAuth: {},
		});
		const login = { refreshToken: 'rt', scopes: ['user:inference'] };

		expect(parseClaudeLogin(stored)).toEqual(login);
		expect(parseClaudeLogin(`${Buffer.from(stored).toString('hex')}\n`)).toEqual(login);
		expect(parseClaudeLogin('{"claudeAiOauth":{"refreshToken":"","scopes":["a"]}}')).toBeNull();
		expect(parseClaudeLogin('not json')).toBeNull();
	});

	it('signs in with the saved token and its own client, never an inherited one', () => {
		expect(
			refreshTokenEnvironment(
				{ PATH: '/usr/bin', CLAUDE_CODE_OAUTH_CLIENT_ID: 'inherited' },
				{ refreshToken: 'rt', scopes: ['user:inference', 'user:profile'] },
			),
		).toEqual({
			PATH: '/usr/bin',
			CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'rt',
			CLAUDE_CODE_OAUTH_SCOPES: 'user:inference user:profile',
		});
	});
});
