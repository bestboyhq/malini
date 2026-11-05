export {
	AGENT_REASONING_EFFORTS,
	AGENT_RUN_MODES,
	AGENT_ACCESS_DETAILS,
	AGENT_ACCESS_LEVELS,
	DEFAULT_AGENT_ACCESS,
	DEFAULT_AGENT_RUN_PROFILE,
	isValidAgentAccess,
	isValidAgentRunProfile,
	normalizeAgentRunProfile,
	reasoningEffortLabel,
	type AgentAccess,
	type AgentReasoningEffort,
	type AgentRunMode,
	type AgentRunProfile,
} from './domain/run-profile';

export {
	AGENT_MODELS,
	DEFAULT_AGENT_MODEL,
	claudeModelFor,
	defaultAgentModel,
	isValidAgentModel,
	persistedAgentModel,
	type AgentModel,
} from './domain/model-id';

export {
	effortsForModel,
	modelLabel,
	normalizeReasoningEffort,
	pickerGroups,
	selectionLabel,
	selectionModels,
	type AgentModelInfo,
} from './domain/model-catalog';

export {
	CHATGPT_PROVIDER_ID,
	CHATGPT_USAGE_URL,
	CLAUDE_PROVIDER,
	CLAUDE_PROVIDER_ID,
	DEFAULT_PROVIDER_ID,
	DEEPSEEK_MODELS,
	DEEPSEEK_PROVIDER_ID,
	isModelAccessReady,
	isValidProviderId,
	modelAccess,
	providerForModel,
	providerGroupFor,
	providerGroups,
	providerKeyUrl,
	type ModelAccess,
	type ProviderGroup,
	type ProviderModelSource,
} from './domain/provider';

export type { ModelProviderKind, ModelProviderRecord } from '$contract/agent';

export {
	DEFAULT_MODEL_PREFERENCES,
	cloneModelSelection,
	isValidModelSelection,
	modelSelectionValue,
	normalizeModelSelection,
	normalizeModelPreferences,
	parseModelSelectionValue,
	preferencesWithRoleSelection,
	roleForAgentMode,
	sameModelSelection,
	selectionForRole,
	type ChatModelSnapshot,
	type ChatSetup,
	type ModelPreferences,
	type ModelRole,
	type ModelSelection,
} from './domain/model-preferences';

export { type ClaudeCodeStatus } from './domain/claude-code-status';

export { cancelChatGptSignInCommand } from './application/commands/cancel-chatgpt-sign-in.command';
export { cancelClaudeSignInCommand } from './application/commands/cancel-claude-sign-in.command';
export { deleteProviderKeyCommand } from './application/commands/delete-provider-key.command';
export { loadModelDefaultsCommand } from './application/commands/load-model-defaults.command';
export { loadModelProvidersCommand } from './application/commands/load-model-providers.command';
export { loadProviderCapabilitiesCommand } from './application/commands/load-provider-capabilities.command';
export { refreshModelProvidersCommand } from './application/commands/refresh-model-providers.command';
export { reloadModelProvidersCommand } from './application/commands/reload-model-providers.command';
export { saveAgentAccessDefaultCommand } from './application/commands/save-agent-access-default.command';
export { saveModelDefaultsCommand } from './application/commands/save-model-defaults.command';
export { saveProviderKeyCommand } from './application/commands/save-provider-key.command';
export { signInToChatGptCommand } from './application/commands/sign-in-to-chatgpt.command';
export { signInToClaudeCommand } from './application/commands/sign-in-to-claude.command';
export { signOutOfChatGptCommand } from './application/commands/sign-out-of-chatgpt.command';

export { agentAccessDefaultQuery } from './application/queries/agent-access-default.query.svelte';
export { chatGptSignInQuery } from './application/queries/chatgpt-sign-in.query.svelte';
export { claudeCodeStatusQuery } from './application/queries/claude-code-status.query.svelte';
export { claudeSignInQuery } from './application/queries/claude-sign-in.query.svelte';
export { modelCatalogQuery } from './application/queries/model-catalog.query.svelte';
export { modelDefaultsQuery } from './application/queries/model-defaults.query.svelte';
export { providerGroupsQuery } from './application/queries/provider-groups.query.svelte';
export { subscriptionBillingQuery } from './application/queries/subscription-billing.query.svelte';

export { default as AgentAccessSettings } from './presentation/AgentAccessSettings.svelte';
export { default as ChatGptCard } from './presentation/ChatGptCard.svelte';
export { default as ClaudeAccountList } from './presentation/ClaudeAccountList.svelte';
export { default as ClaudeCodeSetup } from './presentation/ClaudeCodeSetup.svelte';
export { default as ModelDefaultsSettings } from './presentation/ModelDefaultsSettings.svelte';
export { default as ModelProfilePicker } from './presentation/ModelProfilePicker.svelte';
export { default as ProviderIcon } from './presentation/ProviderIcon.svelte';
export { default as ProviderKeyCard } from './presentation/ProviderKeyCard.svelte';
export { providerSelectOptions } from './presentation/provider-select-options';
export { default as RunProfileControls } from './presentation/RunProfileControls.svelte';
