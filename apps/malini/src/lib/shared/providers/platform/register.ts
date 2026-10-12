import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CLAUDE_INSTALL_COMMAND } from '$contract/agent';
import type { MainContext } from '$main/context';
import { isRecord } from '$main/db/rows';
import {
	buildSpawnEnvironment,
	currentEnvironment,
	resolveToolPath,
} from '$main/process/environment';
import { ClaudeSignIn, type ClaudeSignInDeps } from './claude-sign-in.service';

const MAX_EMAIL_LENGTH = 320;

export interface ProvidersDeps extends Partial<ClaudeSignInDeps> {
	readonly platform?: NodeJS.Platform;
	readonly openPath?: (path: string) => Promise<string>;
}

export interface ProvidersPlatform {
	stop(): void;
}

export function registerProviders(
	context: MainContext,
	deps: ProvidersDeps = {},
): ProvidersPlatform {
	const platform = deps.platform ?? process.platform;
	const openPath = deps.openPath ?? openWithElectron;
	const signIn = new ClaudeSignIn({
		executable: deps.executable ?? claudeExecutable,
		environment: deps.environment ?? buildSpawnEnvironment,
	});

	context.commands.define('providers.install-claude-code', async () => {
		if (platform !== 'darwin') {
			throw new Error(`Run \`${CLAUDE_INSTALL_COMMAND}\` in a terminal, then check again.`);
		}
		const directory = join(context.appDataRoot, 'claude-setup');
		await mkdir(directory, { recursive: true, mode: 0o700 });
		const script = join(directory, 'install.command');
		await writeFile(script, `#!/bin/sh\n${CLAUDE_INSTALL_COMMAND}\n`, { mode: 0o700 });
		const failure = await openPath(script);
		if (failure.length > 0) throw new Error(`Could not open Terminal: ${failure}`);
	});

	context.commands.define('providers.sign-in-to-claude', (args: unknown) =>
		signIn.run(parseEmail(args)),
	);

	context.commands.define('providers.cancel-claude-sign-in', () => signIn.cancel());

	return { stop: () => signIn.cancel() };
}

function parseEmail(args: unknown): string | null {
	const email = isRecord(args) ? args['email'] : undefined;
	if (email === undefined) return null;
	if (
		typeof email !== 'string' ||
		email.length > MAX_EMAIL_LENGTH ||
		!/^[^\s@]+@[^\s@]+$/u.test(email)
	) {
		throw new Error('invalid args: `email` must be an email address');
	}
	return email;
}

function claudeExecutable(): string | null {
	const environment = currentEnvironment();
	const home = homedir();
	const path = [environment.path, join(home, '.local', 'bin'), join(home, '.claude', 'local')];
	return resolveToolPath('claude', { ...environment, path: path.join(':') });
}

async function openWithElectron(path: string): Promise<string> {
	const { shell } = await import('electron');
	return shell.openPath(path);
}
