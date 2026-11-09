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
import { installClaudeCode } from './claude-install';
import { ChatGptProxy } from './chatgpt/proxy';
import {
	CHATGPT_ISSUER,
	CHATGPT_RESOURCE,
	ChatGptAuth,
	type ChatGptEndpoints,
} from './chatgpt/sign-in';
import { ModelsDevCatalog, modelsDevUrl, type CatalogFetch } from './models-dev.service';
import { detectOpenCodePlan, opencodeProbeOrigin } from './opencode-plan';
import { ProviderKeys } from './provider-keys.service';

const MAX_EMAIL_LENGTH = 320;

export interface ProvidersDeps extends Partial<Omit<ClaudeAccountsDeps, 'directory'>> {
	readonly platform?: NodeJS.Platform;
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
	const environment = deps.environment ?? (() => withoutProviderVariables(buildSpawnEnvironment()));
	const accounts = new ClaudeAccounts({
		directory: join(context.appDataRoot, 'claude-accounts'),
		executable: deps.executable ?? claudeExecutable,
		environment,
		security: deps.security ?? (() => (platform === 'darwin' ? resolveToolPath('security') : null)),
		cipher: deps.cipher ?? electronCipher,
	});

	const fetch = deps.fetch ?? electronFetch;
	let claudeInstall: Promise<void> | null = null;
	context.commands.define('providers.install-claude-code', () => {
		if (platform !== 'darwin') {
			throw new Error(`Run \`${CLAUDE_INSTALL_COMMAND}\` in a terminal, then check again.`);
		}
		claudeInstall ??= installClaudeCode({
			fetch,
			directory: join(context.appDataRoot, 'claude-setup'),
			environment: environment(),
			onProgress: (progress) =>
				context.events.emit('providers:claude-code-install-progress', progress),
		}).finally(() => {
			claudeInstall = null;
		});
		return claudeInstall;
	});

	context.commands.define('providers.sign-in-to-claude', (args: unknown) =>
		accounts.signIn(parseEmail(args)),
	);

	context.commands.define('providers.switch-claude-account', (args: unknown) =>
		accounts.switchTo(parseEmail(args) ?? invalidEmail()),
	);

	context.commands.define('providers.cancel-claude-sign-in', () => accounts.cancelSignIn());

	const probeOrigin = opencodeProbeOrigin(!context.isDev, process.env);
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
	const keys = new ProviderKeys(
		context.db,
		deps.cipher ?? electronCipher,
		(apiKey) => detectOpenCodePlan({ apiKey, origin: probeOrigin, fetch }),
		{
			account: () => chatgpt.account(),
			endpoint: () => proxy.address(),
		},
	);
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
		await keys.detectMissingPlan();
		return keys.list();
	});

	context.commands.define('providers.sign-in-to-chatgpt', () => chatgpt.signIn());

	context.commands.define('providers.cancel-chatgpt-sign-in', () => chatgpt.cancelSignIn());

	context.commands.define('providers.sign-out-of-chatgpt', () => chatgpt.signOut());

	context.commands.define('providers.save-key', async (args: unknown) => {
		const { providerId, apiKey } = providerKeyArgs(args);
		await keys.save(providerId, apiKey);
	});

	context.commands.define('providers.check-plan', (args: unknown) =>
		keys.checkPlan(providerIdArg(args)),
	);

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
