import type {
	AgentModelInfo,
	ModelProviderKind,
	ModelProviderRecord,
	ProviderCapability,
} from '$contract/agent';
import { fallbackModelCatalog } from './model-catalog';

export const CLAUDE_PROVIDER_ID = 'claude';
export const DEFAULT_PROVIDER_ID = CLAUDE_PROVIDER_ID;

export const DEEPSEEK_PROVIDER_ID = 'deepseek';
export const DEEPSEEK_PROVIDER_NAME = 'DeepSeek';
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/anthropic';
export const DEEPSEEK_SUBAGENT_MODEL = 'deepseek-flash';

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
};

export interface ProviderModelSource {
	id: string;
	models: readonly (string | { id: string })[];
}

export interface ProviderGroup {
	id: string;
	name: string;
	kind: ModelProviderKind;
	models: readonly AgentModelInfo[];
	ready: boolean;
	message: string;
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
		models: claudeModels,
		ready: capability?.state === 'ready',
		message: capability?.message ?? 'Claude Code needs setup',
	};
	const custom = providers
		.filter((provider) => provider.id !== CLAUDE_PROVIDER_ID)
		.map((provider) => ({
			id: provider.id,
			name: provider.name,
			kind: provider.kind,
			models: provider.models,
			ready: provider.keySaved,
			message: provider.keySaved ? 'Ready' : `Add an API key for ${provider.name}`,
		}));
	const seen = new Set<string>();
	return [claude, ...custom].map((group) => ({
		...group,
		models: group.models.filter((model) => {
			if (seen.has(model.id)) return false;
			seen.add(model.id);
			return true;
		}),
	}));
}

export function providerGroupFor(
	groups: readonly ProviderGroup[],
	providerId: string,
): ProviderGroup | null {
	return groups.find((group) => group.id === providerId) ?? null;
}
