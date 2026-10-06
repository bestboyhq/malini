import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { isRecord } from '../type-guards.js';

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 10_000;

export const CLAUDE_INSTALL_COMMAND = 'curl -fsSL https://claude.ai/install.sh | bash';
export const CLAUDE_LOGIN_COMMAND = 'claude auth login';

export interface ClaudeAccount {
	readonly email?: string;
	readonly plan?: string;
}

export type ClaudeAuthStatus =
	{ readonly signedIn: true; readonly account: ClaudeAccount } | { readonly signedIn: false };

export function findClaudeExecutable(env: NodeJS.ProcessEnv = process.env): string | null {
	const pathEntries = (env['PATH'] ?? '').split(delimiter).filter(Boolean);
	const home = env['HOME'] ?? homedir();
	const candidates = [
		...pathEntries.map((entry) => join(entry, 'claude')),
		join(home, '.local', 'bin', 'claude'),
		join(home, '.claude', 'local', 'claude'),
		'/opt/homebrew/bin/claude',
		'/usr/local/bin/claude',
	];
	return candidates.find(isExecutable) ?? null;
}

function isExecutable(path: string): boolean {
	try {
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

export async function claudeVersion(executable: string): Promise<string> {
	const { stdout } = await execFileAsync(executable, ['--version'], { timeout: PROBE_TIMEOUT_MS });
	return stdout.trim().split(/\s+/u)[0] ?? stdout.trim();
}

export async function claudeAuthStatus(executable: string): Promise<ClaudeAuthStatus> {
	let stdout: string;
	try {
		({ stdout } = await execFileAsync(executable, ['auth', 'status', '--json'], {
			timeout: PROBE_TIMEOUT_MS,
		}));
	} catch (error) {
		stdout = isRecord(error) && typeof error['stdout'] === 'string' ? error['stdout'] : '';
	}
	return parseClaudeAuthStatus(stdout);
}

export function parseClaudeAuthStatus(stdout: string): ClaudeAuthStatus {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		return { signedIn: false };
	}
	if (!isRecord(parsed) || parsed['loggedIn'] !== true) return { signedIn: false };
	const email = parsed['email'];
	const plan = parsed['subscriptionType'];
	return {
		signedIn: true,
		account: {
			...(typeof email === 'string' && email ? { email } : {}),
			...(typeof plan === 'string' && plan ? { plan: planName(plan) } : {}),
		},
	};
}

function planName(subscriptionType: string): string {
	if (/^claude\b/iu.test(subscriptionType)) return subscriptionType;
	return `Claude ${subscriptionType.charAt(0).toUpperCase()}${subscriptionType.slice(1)}`;
}
