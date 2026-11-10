import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { isRecord } from '$main/db/rows';
import { runWithTimeout } from '$main/process/environment';

const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const KEYCHAIN_ACCOUNT_PATTERN = /^[a-zA-Z0-9._-]+$/u;
const FALLBACK_KEYCHAIN_ACCOUNT = 'claude-code-user';
const HEX_PATTERN = /^(?:[0-9a-f]{2})+$/iu;
const KEYCHAIN_TIMEOUT_MS = 5_000;
const STATUS_TIMEOUT_MS = 10_000;

export type SpawnEnvironment = Readonly<Record<string, string>>;

export interface ClaudeLogin {
	readonly refreshToken: string;
	readonly scopes: readonly string[];
	readonly clientId?: string;
}

export interface ClaudeLoginStorage {
	readonly service: string;
	readonly account: string;
	readonly file: string;
}

export function claudeLoginStorage(
	env: SpawnEnvironment,
	home: string = homedir(),
): ClaudeLoginStorage {
	const configured = env['CLAUDE_CONFIG_DIR'];
	const directory = (configured ?? join(home, '.claude')).normalize('NFC');
	const suffix = configured
		? `-${createHash('sha256').update(directory).digest('hex').slice(0, 8)}`
		: '';
	return {
		service: `${KEYCHAIN_SERVICE}${suffix}`,
		account: keychainAccount(env),
		file: join(directory, '.credentials.json'),
	};
}

function keychainAccount(env: SpawnEnvironment): string {
	let user: string;
	try {
		user = env['USER'] || userInfo().username;
	} catch {
		return FALLBACK_KEYCHAIN_ACCOUNT;
	}
	return KEYCHAIN_ACCOUNT_PATTERN.test(user) ? user : FALLBACK_KEYCHAIN_ACCOUNT;
}

export function parseClaudeLogin(stored: string): ClaudeLogin | null {
	const text = stored.trim();
	let parsed: unknown;
	try {
		parsed = JSON.parse(HEX_PATTERN.test(text) ? Buffer.from(text, 'hex').toString('utf8') : text);
	} catch {
		return null;
	}
	const oauth = isRecord(parsed) ? parsed['claudeAiOauth'] : null;
	return isRecord(oauth) ? claudeLoginFrom(oauth) : null;
}

export function claudeLoginFrom(value: Record<string, unknown>): ClaudeLogin | null {
	const { refreshToken, scopes, clientId } = value;
	if (typeof refreshToken !== 'string' || !refreshToken || !Array.isArray(scopes)) return null;
	const named = scopes.filter((scope): scope is string => typeof scope === 'string' && !!scope);
	if (named.length === 0) return null;
	return {
		refreshToken,
		scopes: named,
		...(typeof clientId === 'string' && clientId ? { clientId } : {}),
	};
}

export async function readClaudeLogin(
	storage: ClaudeLoginStorage,
	security: string | null,
): Promise<ClaudeLogin | null> {
	if (security) {
		const result = await runWithTimeout(
			security,
			['find-generic-password', '-a', storage.account, '-w', '-s', storage.service],
			{ timeoutMs: KEYCHAIN_TIMEOUT_MS },
		).catch(() => null);
		const login = result?.exitCode === 0 ? parseClaudeLogin(result.stdout) : null;
		if (login) return login;
	}
	const stored = await readFile(storage.file, 'utf8').catch(() => null);
	return stored === null ? null : parseClaudeLogin(stored);
}

export function refreshTokenEnvironment(
	base: SpawnEnvironment,
	login: ClaudeLogin,
): SpawnEnvironment {
	const env: Record<string, string> = {
		...base,
		CLAUDE_CODE_OAUTH_REFRESH_TOKEN: login.refreshToken,
		CLAUDE_CODE_OAUTH_SCOPES: login.scopes.join(' '),
	};
	delete env['CLAUDE_CODE_OAUTH_CLIENT_ID'];
	if (login.clientId) env['CLAUDE_CODE_OAUTH_CLIENT_ID'] = login.clientId;
	return env;
}

export async function signedInClaudeEmail(
	executable: string,
	env: SpawnEnvironment,
): Promise<string | null> {
	const result = await runWithTimeout(executable, ['auth', 'status', '--json'], {
		env,
		timeoutMs: STATUS_TIMEOUT_MS,
	}).catch(() => null);
	let status: unknown;
	try {
		status = JSON.parse(result?.stdout ?? '');
	} catch {
		return null;
	}
	if (!isRecord(status) || status['loggedIn'] !== true) return null;
	const email = status['email'];
	return typeof email === 'string' && email ? email : null;
}
