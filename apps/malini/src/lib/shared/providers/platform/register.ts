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
import { withoutProviderVariables } from '$shared/providers/domain/provider-env';
import {
	ClaudeAccounts,
	type ClaudeAccountsDeps,
	type SecretCipher,
} from './claude-accounts.service';
import { ChatGptAccount } from './chatgpt/account.service';
import { ChatGptProxy } from './chatgpt/proxy';
import {
	CHATGPT_ISSUER,
	CHATGPT_RESOURCE,
	ChatGptAuth,
	type ChatGptEndpoints,
} from './chatgpt/sign-in';
import { ModelsDevCatalog, modelsDevUrl, type CatalogFetch } from './models-dev.service';
import { ProviderKeys } from './provider-keys.service';

const MAX_EMAIL_LENGTH = 320;

export interface ProvidersDeps extends Partial<Omit<ClaudeAccountsDeps, 'directory'>> {
	readonly platform?: NodeJS.Platform;
	readonly openPath?: (path: string) => Promise<string>;
	readonly openExternal?: (url: string) => Promise<void>;
	readonly fetch?: CatalogFetch;
}

export interface ProvidersPlatform {
	readonly keys: ProviderKeys;
	stop(): void;
}

export function registerProviders(
	context: MainContext,
	deps: ProvidersDeps = {},
): ProvidersPlatform {
	const platform = deps.platform ?? process.platform;
	const openPath = deps.openPath ?? openWithElectron;
	const accounts = new ClaudeAccounts({
		directory: join(context.appDataRoot, 'claude-accounts'),
		executable: deps.executable ?? claudeExecutable,
		environment: deps.environment ?? (() => withoutProviderVariables(buildSpawnEnvironment())),
		security: deps.security ?? (() => (platform === 'darwin' ? resolveToolPath('security') : null)),
		cipher: deps.cipher ?? electronCipher,
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
		accounts.signIn(parseEmail(args)),
	);

	context.commands.define('providers.switch-claude-account', (args: unknown) =>
		accounts.switchTo(parseEmail(args) ?? invalidEmail()),
	);

	context.commands.define('providers.cancel-claude-sign-in', () => accounts.cancelSignIn());

	const fetch = deps.fetch ?? electronFetch;
	const endpoints = chatGptEndpoints(!context.isDev, process.env);
	const chatgpt = new ChatGptAccount({
		db: context.db,
		cipher: deps.cipher ?? electronCipher,
		auth: new ChatGptAuth({
			endpoints,
			fetch,
			openExternal: deps.openExternal ?? openExternalWithElectron,
		}),
		endpoints,
		fetch,
	});
	const proxy = new ChatGptProxy({
		endpoints,
		fetch,
		accessToken: (force) => chatgpt.accessToken(force),
		onUsageLimit: (reached) => chatgpt.noteUsageLimit(reached),
		userAgent: `Malini/${context.appVersion}`,
	});
	const keys = new ProviderKeys(context.db, deps.cipher ?? electronCipher, {
		account: () => chatgpt.account(),
		endpoint: async (session) => {
			if (session === 'new') await chatgpt.accessToken();
			return proxy.address();
		},
	});
	const catalog = new ModelsDevCatalog({
		db: context.db,
		fetch,
		url: modelsDevUrl(!context.isDev, process.env),
	});
	void catalog.refresh();
	void chatgpt.refreshModels().catch(() => undefined);

	context.commands.define('providers.list', () => keys.list());

	context.commands.define('providers.refresh-models', async () => {
		await Promise.all([catalog.refresh(), chatgpt.refreshModels().catch(() => undefined)]);
		return keys.list();
	});

	context.commands.define('providers.sign-in-to-chatgpt', () => chatgpt.signIn());

	context.commands.define('providers.cancel-chatgpt-sign-in', () => chatgpt.cancelSignIn());

	context.commands.define('providers.sign-out-of-chatgpt', () => chatgpt.signOut());

	context.commands.define('providers.save-key', async (args: unknown) => {
		const { providerId, apiKey } = providerKeyArgs(args);
		await keys.save(providerId, apiKey);
	});

	context.commands.define('providers.delete-key', (args: unknown) =>
		keys.delete(providerIdArg(args)),
	);

	return {
		keys,
		stop: () => {
			accounts.cancelSignIn();
			chatgpt.cancelSignIn();
			proxy.stop();
		},
	};
}

export function chatGptEndpoints(
	packaged: boolean,
	env: Readonly<Record<string, string | undefined>>,
): ChatGptEndpoints {
	return {
		issuer: (!packaged && env['MALINI_CHATGPT_ISSUER']) || CHATGPT_ISSUER,
		resource: (!packaged && env['MALINI_CHATGPT_RESOURCE']) || CHATGPT_RESOURCE,
	};
}

function providerKeyArgs(args: unknown): Readonly<{ providerId: string; apiKey: string }> {
	const providerId = isRecord(args) ? args['providerId'] : undefined;
	const apiKey = isRecord(args) ? args['apiKey'] : undefined;
	if (typeof providerId !== 'string' || typeof apiKey !== 'string') {
		throw new Error('invalid args: `providerId` and `apiKey` must be strings');
	}
	return { providerId, apiKey };
}

function providerIdArg(args: unknown): string {
	const providerId = isRecord(args) ? args['providerId'] : undefined;
	if (typeof providerId !== 'string')
		throw new Error('invalid args: `providerId` must be a string');
	return providerId;
}

function parseEmail(args: unknown): string | null {
	const email = isRecord(args) ? args['email'] : undefined;
	if (email === undefined) return null;
	if (
		typeof email !== 'string' ||
		email.length > MAX_EMAIL_LENGTH ||
		!/^[^\s@]+@[^\s@]+$/u.test(email)
	) {
		return invalidEmail();
	}
	return email;
}

function invalidEmail(): never {
	throw new Error('invalid args: `email` must be an email address');
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

async function openExternalWithElectron(url: string): Promise<void> {
	const { shell } = await import('electron');
	await shell.openExternal(url);
}

async function electronFetch(url: string, init: RequestInit): Promise<Response> {
	const { net } = await import('electron');
	return net.fetch(url, init);
}

async function electronCipher(): Promise<SecretCipher> {
	const { safeStorage } = await import('electron');
	return safeStorage;
}
