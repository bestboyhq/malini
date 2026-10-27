import { defaultProviderRegistry, type ProviderRegistry } from '../providers/registry.js';
import type { ProviderFactory } from '../providers/types.js';
import { findClaudeExecutable } from './installation.js';
import { AutoModeOutage } from './permissions.js';
import { ClaudeSession, type QueryFunction } from './session.js';

export interface ClaudeProviderOptions {
	readonly findExecutable?: () => string | null;
	readonly query?: QueryFunction;
}

export function createClaudeProviderFactory(options: ClaudeProviderOptions = {}): ProviderFactory {
	const findExecutable = options.findExecutable ?? findClaudeExecutable;
	const outage = new AutoModeOutage();
	return async (context, emit) =>
		new ClaudeSession({
			context,
			emit,
			executable: findExecutable(),
			outage,
			...(options.query ? { query: options.query } : {}),
		});
}

export function registerClaudeProvider(
	registry: ProviderRegistry = defaultProviderRegistry,
	options: ClaudeProviderOptions = {},
): void {
	registry.setProvider(createClaudeProviderFactory(options));
}
