import { defaultProviderRegistry, type ProviderRegistry } from '../providers/registry.js';
import type { ProviderFactory } from '../providers/types.js';
import { findClaudeExecutable } from './installation.js';
import { AutoModeOutage } from './permissions.js';
import { bridgeSecretsFolder, SessionSecrets, sessionSecretsFolder } from './secrets.js';
import { ClaudeSession, type QueryFunction } from './session.js';

export interface ClaudeProviderOptions {
	readonly findExecutable?: () => string | null;
	readonly query?: QueryFunction;
}

export function createClaudeProviderFactory(options: ClaudeProviderOptions = {}): ProviderFactory {
	const findExecutable = options.findExecutable ?? findClaudeExecutable;
	const outage = new AutoModeOutage();
	let secretsFolder: string | null = null;
	return async (context, emit) => {
		secretsFolder ??= bridgeSecretsFolder();
		return new ClaudeSession({
			context,
			emit,
			executable: findExecutable(),
			outage,
			secrets: new SessionSecrets(sessionSecretsFolder(secretsFolder)),
			...(options.query ? { query: options.query } : {}),
		});
	};
}

export function registerClaudeProvider(
	registry: ProviderRegistry = defaultProviderRegistry,
	options: ClaudeProviderOptions = {},
): void {
	registry.setProvider(createClaudeProviderFactory(options));
}
