import { BRIDGE_DEFAULT_MODEL, BRIDGE_MODELS } from '$contract/protocol-contract.generated';

export type AgentModel = string;

export const AGENT_MODELS: readonly AgentModel[] = BRIDGE_MODELS;

export const DEFAULT_AGENT_MODEL: AgentModel = BRIDGE_DEFAULT_MODEL;

const CLAUDE_MODEL_ID = /^[a-z0-9][a-z0-9.-]{0,127}(?:\[1m\])?$/u;
const LEGACY_FAMILIES = ['opus', 'sonnet', 'haiku'] as const;

export function isValidAgentModel(value: unknown): value is AgentModel {
	return typeof value === 'string' && CLAUDE_MODEL_ID.test(value);
}

export function claudeModelFor(persisted: string | null | undefined): AgentModel {
	if (typeof persisted === 'string' && CLAUDE_MODEL_ID.test(persisted)) return persisted;
	const legacy = persisted?.startsWith('anthropic/') ? persisted.slice('anthropic/'.length) : '';
	return LEGACY_FAMILIES.find((family) => legacy.includes(family)) ?? DEFAULT_AGENT_MODEL;
}

export function defaultAgentModel(): AgentModel {
	return DEFAULT_AGENT_MODEL;
}
