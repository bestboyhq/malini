import type {
	AgentModelInfo,
	ModelProviderKind,
	ModelProviderRecord,
	ProviderAccount,
	ProviderCapability,
} from '$contract/agent';
import type { ClaudeCodeStatus } from './claude-code-status';
import { fallbackModelCatalog } from './model-catalog';
import type { ModelSelection } from './model-preferences';

export const CLAUDE_PROVIDER_ID = 'claude';
export const DEFAULT_PROVIDER_ID = CLAUDE_PROVIDER_ID;

export const DEEPSEEK_PROVIDER_ID = 'deepseek';
export const OPENCODE_PROVIDER_ID = 'opencode';
export const CHATGPT_PROVIDER_ID = 'chatgpt';
export const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage';

const PROVIDER_KEY_URLS: Readonly<Record<string, string>> = {
	[DEEPSEEK_PROVIDER_ID]: 'https://platform.deepseek.com/api_keys',
	[OPENCODE_PROVIDER_ID]: 'https://opencode.ai/console',
};

export function providerKeyUrl(providerId: string): string | null {
	return PROVIDER_KEY_URLS[providerId] ?? null;
}

export const DEEPSEEK_MODELS: readonly AgentModelInfo[] = [
	{
		id: 'deepseek-v4-pro',
		label: 'DeepSeek V4 Pro',
		description: 'Text only, best for complex work',
		efforts: ['low', 'high', 'max'],
	},
	{
		id: 'deepseek-flash',
		label: 'DeepSeek V4 Flash',
		description: 'Text and images, faster',
		efforts: ['low', 'high', 'max'],
	},
];

export const CLAUDE_PROVIDER: ModelProviderRecord = {
	id: CLAUDE_PROVIDER_ID,
	name: 'Claude',
	kind: 'claude',
	baseUrl: null,
	models: [],
	keySaved: false,
	account: null,
};

export interface ProviderModelSource {
	id: string;
	models: readonly (string | { id: string })[];
}

export interface ProviderGroup {
	id: string;
	name: string;
	kind: ModelProviderKind;
	baseUrl: string | null;
	models: readonly AgentModelInfo[];
	ready: boolean;
	message: string;
	account: ProviderAccount | null;
}

const CUSTOM_PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;

export function isValidProviderId(value: unknown): value is string {
	return typeof value === 'string' && CUSTOM_PROVIDER_ID.test(value);
}

export function providerForModel(
	model: string,
	providers: readonly ProviderModelSource[] = [],
): string {
	const custom = providers.find(
		(provider) =>
			provider.id !== CLAUDE_PROVIDER_ID &&
			provider.models.some((candidate) =>
				typeof candidate === 'string' ? candidate === model : candidate.id === model,
			),
	);
	return custom?.id ?? CLAUDE_PROVIDER_ID;
}

export function providerGroups(
	capability: ProviderCapability | null,
	providers: readonly ModelProviderRecord[],
): readonly ProviderGroup[] {
	const claudeModels = capability?.models ?? fallbackModelCatalog();
	const claude: ProviderGroup = {
		id: CLAUDE_PROVIDER_ID,
		name: 'Claude',
		kind: 'claude',
		baseUrl: null,
		models: claudeModels,
		ready: capability?.state === 'ready',
		message: capability?.message ?? 'Claude Code needs setup',
		account: null,
	};
	const custom = providers
		.filter((provider) => provider.id !== CLAUDE_PROVIDER_ID)
		.map((provider) => customGroup(provider));
	return [claude, ...custom];
}

function customGroup(provider: ModelProviderRecord): ProviderGroup {
	const ready = provider.kind === 'chatgpt' ? provider.account !== null : provider.keySaved;
	const missing =
		provider.kind === 'chatgpt'
			? `Sign in to ${provider.name}`
			: `Add an API key for ${provider.name}`;
	return {
		id: provider.id,
		name: provider.name,
		kind: provider.kind,
		baseUrl: provider.baseUrl,
		models: provider.models,
		ready,
		message: ready ? 'Ready' : missing,
		account: provider.account,
	};
}

export function providerGroupFor(
	groups: readonly ProviderGroup[],
	providerId: string,
): ProviderGroup | null {
	return groups.find((group) => group.id === providerId) ?? null;
}

export type ModelAccess =
	| { readonly kind: 'ready' }
	| { readonly kind: 'checking' }
	| { readonly kind: 'claude-code-missing' }
	| { readonly kind: 'claude-signed-out' }
	| { readonly kind: 'chatgpt-signed-out' }
	| { readonly kind: 'chatgpt-model-missing' }
	| {
			readonly kind: 'needs-key';
			readonly providerId: string;
			readonly providerName: string;
	  };

export function modelAccess(
	selection: ModelSelection,
	groups: readonly ProviderGroup[],
	claudeStatus: ClaudeCodeStatus,
): ModelAccess {
	if (selection.provider === CLAUDE_PROVIDER_ID) {
		switch (claudeStatus.kind) {
			case 'missing':
				return { kind: 'claude-code-missing' };
			case 'signed-out':
				return { kind: 'claude-signed-out' };
			case 'checking':
			case 'unknown':
				return { kind: 'checking' };
			case 'ready':
				return { kind: 'ready' };
		}
	}
	const group = providerGroupFor(groups, selection.provider);
	if (!group) {
		return {
			kind: 'needs-key',
			providerId: selection.provider,
			providerName: selection.provider,
		};
	}
	if (group.kind === 'chatgpt') {
		if (!group.ready) return { kind: 'chatgpt-signed-out' };
		return group.models.some((model) => model.id === selection.model)
			? { kind: 'ready' }
			: { kind: 'chatgpt-model-missing' };
	}
	return group.ready
		? { kind: 'ready' }
		: { kind: 'needs-key', providerId: group.id, providerName: group.name };
}

export function isModelAccessReady(access: ModelAccess): boolean {
	return access.kind === 'ready' || access.kind === 'checking';
}
