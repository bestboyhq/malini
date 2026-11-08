import type { ModelProviderKind } from '$contract/agent';

export interface ProviderEnvironmentInput {
	readonly name: string;
	readonly kind: ModelProviderKind;
	readonly baseUrl: string | null;
	readonly apiKey: string | null;
	readonly model: string;
	readonly subagentModel: string | null;
}

export class ProviderNotConnectedError extends Error {}

export function providerEnvironment(input: ProviderEnvironmentInput): Record<string, string> {
	if (input.kind === 'claude') return {};
	if (input.baseUrl === null) throw new Error(`${input.name} has no base URL`);
	if (input.apiKey === null || input.apiKey.length === 0) {
		throw new ProviderNotConnectedError(
			`${input.name} needs an API key. Add it in Settings, then try again.`,
		);
	}
	const subagentModel = input.subagentModel ?? input.model;
	return {
		ANTHROPIC_BASE_URL: input.baseUrl,
		ANTHROPIC_AUTH_TOKEN: input.apiKey,
		ANTHROPIC_MODEL: input.model,
		ANTHROPIC_DEFAULT_OPUS_MODEL: input.model,
		ANTHROPIC_DEFAULT_SONNET_MODEL: input.model,
		ANTHROPIC_DEFAULT_HAIKU_MODEL: input.model,
		CLAUDE_CODE_SUBAGENT_MODEL: subagentModel,
	};
}

export function withoutProviderVariables(
	env: Readonly<Record<string, string>>,
): Record<string, string> {
	return Object.fromEntries(Object.entries(env).filter(([name]) => !isProviderVariable(name)));
}

function isProviderVariable(name: string): boolean {
	return (
		name.startsWith('ANTHROPIC_') ||
		name === 'CLAUDE_CODE_SUBAGENT_MODEL' ||
		name === 'CLAUDE_CODE_EFFORT_LEVEL'
	);
}
