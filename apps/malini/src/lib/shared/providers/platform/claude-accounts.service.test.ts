import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isRecord } from '$main/db/rows';
import { ClaudeAccounts, type SecretCipher } from './claude-accounts.service';

const PRIVATE = 'me@private.example';
const WORK = 'me@work.example';
const SIGNED_IN_ITEM = `${encodeURIComponent('Claude Code-credentials')}.json`;

const FAKE_SHARED = `
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const keychain = path.join(root, 'keychain');
const itemFor = (service) => path.join(keychain, encodeURIComponent(service) + '.json');
const log = (entry) => fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify(entry) + '\\n');
`;

const FAKE_SECURITY = `${FAKE_SHARED}
const args = process.argv.slice(2);
const item = itemFor(args[args.indexOf('-s') + 1]);
if (!fs.existsSync(item)) {
	process.stderr.write('The specified item could not be found in the keychain.\\n');
	process.exit(44);
}
process.stdout.write(Buffer.from(fs.readFileSync(item, 'utf8')).toString('hex') + '\\n');
`;

const FAKE_CLAUDE = `${FAKE_SHARED}
const args = process.argv.slice(2);
const item = itemFor('Claude Code-credentials');
const serverFile = path.join(root, 'server.json');
const server = fs.existsSync(serverFile)
	? JSON.parse(fs.readFileSync(serverFile, 'utf8'))
	: { tokens: {}, issued: 0 };
const signIn = (email, scopes) => {
	server.issued += 1;
	const refreshToken = 'rt-' + server.issued;
	server.tokens[refreshToken] = email;
	fs.writeFileSync(serverFile, JSON.stringify(server));
	fs.mkdirSync(keychain, { recursive: true });
	fs.writeFileSync(item, JSON.stringify({ claudeAiOauth: { refreshToken, scopes }, email }));
};
if (args[1] === 'status') {
	const stored = fs.existsSync(item) ? JSON.parse(fs.readFileSync(item, 'utf8')) : null;
	process.stdout.write(JSON.stringify(stored ? { loggedIn: true, email: stored.email } : { loggedIn: false }));
	process.exit(0);
}
const refreshToken = process.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN;
const email = (args[2] || '').replace('--email=', '');
log({ refreshToken: refreshToken || null, scopes: process.env.CLAUDE_CODE_OAUTH_SCOPES || null, email });
if (!refreshToken) signIn(email, ['user:inference', 'user:profile']);
else if (server.tokens[refreshToken]) {
	const owner = server.tokens[refreshToken];
	delete server.tokens[refreshToken];
	signIn(owner, process.env.CLAUDE_CODE_OAUTH_SCOPES.split(' '));
} else {
	process.stderr.write('Login from refresh token failed: Request failed with status code 400\\n');
	process.exit(1);
}
process.stdout.write('Login successful.\\n');
`;

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const reversing: SecretCipher = {
	isEncryptionAvailable: () => true,
	encryptString: (plainText) => Buffer.from(plainText, 'utf8').reverse(),
	decryptString: (encrypted) => Buffer.from(encrypted).reverse().toString('utf8'),
};

function readJson(file: string): unknown {
	return JSON.parse(readFileSync(file, 'utf8'));
}

function fakeClaudeCode(cipher: SecretCipher = reversing) {
	const root = mkdtempSync(join(tmpdir(), 'malini-claude-accounts-'));
	roots.push(root);
	const tool = (name: string, body: string): string => {
		const file = join(root, name);
		writeFileSync(file, `#!${process.execPath}\n${body}`);
		chmodSync(file, 0o755);
		return file;
	};
	const claude = tool('claude', FAKE_CLAUDE);
	const security = tool('security', FAKE_SECURITY);
	const directory = join(root, 'malini');
	const accounts = new ClaudeAccounts({
		directory,
		executable: () => claude,
		environment: () => ({ PATH: '/usr/bin:/bin', USER: 'tester' }),
		security: () => security,
		cipher: async () => cipher,
	});
	const logins = (): unknown[] =>
		existsSync(join(root, 'calls.jsonl'))
			? readFileSync(join(root, 'calls.jsonl'), 'utf8')
					.trim()
					.split('\n')
					.map((line): unknown => JSON.parse(line))
			: [];
	const signedIn = (): unknown => {
		const item = join(root, 'keychain', SIGNED_IN_ITEM);
		const stored = existsSync(item) ? readJson(item) : null;
		return isRecord(stored) ? stored['email'] : null;
	};
	const revoke = (email: string): void => {
		const file = join(root, 'server.json');
		const server = readJson(file);
		const tokens = isRecord(server) && isRecord(server['tokens']) ? server['tokens'] : {};
		const kept = Object.entries(tokens).filter(([, owner]) => owner !== email);
		writeFileSync(
			file,
			JSON.stringify({ ...(isRecord(server) ? server : {}), tokens: Object.fromEntries(kept) }),
		);
	};
	return { directory, accounts, logins, signedIn, revoke };
}

describe('Claude accounts', () => {
	it('keeps the account you leave signed in, so switching back takes no browser', async () => {
		const claude = fakeClaudeCode();
		expect(await claude.accounts.signIn(PRIVATE)).toBe('signed-in');
		expect(await claude.accounts.switchTo(WORK)).toBe('sign-in-needed');
		expect(await claude.accounts.signIn(WORK)).toBe('signed-in');
		expect(claude.signedIn()).toBe(WORK);

		expect(await claude.accounts.switchTo(PRIVATE)).toBe('switched');
		expect(claude.signedIn()).toBe(PRIVATE);
		expect(claude.logins().at(-1)).toEqual({
			refreshToken: 'rt-1',
			scopes: 'user:inference user:profile',
			email: '',
		});

		expect(await claude.accounts.switchTo(WORK)).toBe('switched');
		expect(claude.signedIn()).toBe(WORK);
		expect(claude.logins()).toHaveLength(4);
		expect(readFileSync(join(claude.directory, 'saved-logins'), 'utf8')).not.toContain('rt-');
	});

	it('drops a saved login Claude no longer accepts and asks for the browser instead', async () => {
		const claude = fakeClaudeCode();
		await claude.accounts.signIn(PRIVATE);
		await claude.accounts.signIn(WORK);
		claude.revoke(PRIVATE);

		expect(await claude.accounts.switchTo(PRIVATE)).toBe('sign-in-needed');
		expect(claude.signedIn()).toBe(WORK);
		const attempts = claude.logins().length;
		expect(await claude.accounts.switchTo(PRIVATE)).toBe('sign-in-needed');
		expect(claude.logins()).toHaveLength(attempts);
	});

	it('cancels a sign-in before it reaches the browser', async () => {
		const claude = fakeClaudeCode();
		await claude.accounts.signIn(PRIVATE);

		const waiting = claude.accounts.signIn(WORK);
		claude.accounts.cancelSignIn();

		expect(await waiting).toBe('cancelled');
		expect(claude.signedIn()).toBe(PRIVATE);
		expect(claude.logins()).toHaveLength(1);
	});

	it('saves nothing when this Mac cannot encrypt it', async () => {
		const claude = fakeClaudeCode({ ...reversing, isEncryptionAvailable: () => false });
		await claude.accounts.signIn(PRIVATE);
		await claude.accounts.signIn(WORK);

		expect(existsSync(join(claude.directory, 'saved-logins'))).toBe(false);
		expect(await claude.accounts.switchTo(PRIVATE)).toBe('sign-in-needed');
	});
});
