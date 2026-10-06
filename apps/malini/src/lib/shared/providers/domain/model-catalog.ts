import type { AgentModelInfo } from '$contract/agent';
import { AGENT_MODELS } from './model-id';
import { AGENT_REASONING_EFFORTS, type AgentReasoningEffort } from './run-profile';

export type { AgentModelInfo };

const FAMILY_ORDER = ['default', 'fable', 'opus', 'sonnet', 'haiku'];

export function modelLabel(model: string): string {
	const contextSuffix = model.endsWith('[1m]') ? ' 1M' : '';
	const words = model
		.replace(/\[1m\]$/u, '')
		.replace(/^claude-/u, '')
		.replace(/-\d{8}$/u, '')
		.replace(/-(\d+)-(\d+)$/u, '-$1.$2')
		.split('-')
		.filter(Boolean)
		.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`);
	return `${words.join(' ')}${contextSuffix}`;
}

export function catalogModelLabel(models: readonly AgentModelInfo[], model: string): string {
	const label = models.find((candidate) => candidate.id === model)?.label;
	return label && label !== model ? label : modelLabel(model);
}

export function pickerModels(
	models: readonly AgentModelInfo[],
	current: string,
): readonly AgentModelInfo[] {
	const listed = models.some((model) => model.id === current)
		? models
		: [...models, unlistedModel(current)];
	return listed
		.map((model) => ({ ...model, label: catalogModelLabel(listed, model.id) }))
		.sort((left, right) => familyRank(left.id) - familyRank(right.id));
}

export function effortsForModel(
	models: readonly AgentModelInfo[],
	model: string,
): readonly AgentReasoningEffort[] {
	return models.find((candidate) => candidate.id === model)?.efforts ?? AGENT_REASONING_EFFORTS;
}

export function normalizeReasoningEffort(
	efforts: readonly AgentReasoningEffort[],
	effort: AgentReasoningEffort,
): AgentReasoningEffort {
	if (efforts.includes(effort)) return effort;
	return efforts.includes('high') ? 'high' : (efforts.at(-1) ?? effort);
}

export function fallbackModelCatalog(): readonly AgentModelInfo[] {
	return AGENT_MODELS.map(unlistedModel);
}

function unlistedModel(id: string): AgentModelInfo {
	return { id, label: modelLabel(id), description: '', efforts: [...AGENT_REASONING_EFFORTS] };
}

function familyRank(model: string): number {
	const family = FAMILY_ORDER.findIndex((name) => model.replace(/^claude-/u, '').startsWith(name));
	return family === -1 ? FAMILY_ORDER.length : family;
}
