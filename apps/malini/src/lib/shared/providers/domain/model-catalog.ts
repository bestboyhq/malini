import type { AgentModelInfo } from '$contract/agent';
import { AGENT_MODELS } from './model-id';
import type { ModelSelection } from './model-preferences';
import type { ProviderGroup } from './provider';
import { AGENT_REASONING_EFFORTS, type AgentReasoningEffort } from './run-profile';

export type { AgentModelInfo };

const FAMILY_ORDER = ['fable', 'opus', 'sonnet', 'haiku'];

const MODEL_DESCRIPTIONS: Readonly<Record<string, string>> = {
	fable: 'For problems that fight back',
	opus: 'Does the real work. Usually right',
	sonnet: 'Routine work, no drama, less usage',
	haiku: "Fast. Don't ask it to ponder",
	'deepseek-v4-pro': 'Thinks hard. Text only',
	'deepseek-flash': 'Quick, and it can see',
};

export function modelDescription(model: AgentModelInfo): string {
	const id = model.id.replace(/^claude-/u, '');
	const key = Object.keys(MODEL_DESCRIPTIONS).find((name) => id.startsWith(name));
	return (key && MODEL_DESCRIPTIONS[key]) ?? model.description;
}

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

export function allProviderModels(groups: readonly ProviderGroup[]): readonly AgentModelInfo[] {
	return groups.flatMap((group) => group.models);
}

export function selectionModels(
	groups: readonly ProviderGroup[],
	selection: ModelSelection,
): readonly AgentModelInfo[] {
	const own = groups.find((group) => group.id === selection.provider)?.models ?? [];
	return own.some((model) => model.id === selection.model)
		? own
		: [...own, ...allProviderModels(groups)];
}

export function selectionLabel(
	groups: readonly ProviderGroup[],
	selection: ModelSelection,
): string {
	return catalogModelLabel(selectionModels(groups, selection), selection.model);
}

export function pickerGroups(
	groups: readonly ProviderGroup[],
	selection: ModelSelection,
): readonly ProviderGroup[] {
	const catalog = allProviderModels(groups);
	const selectedGroup = groups.find((group) => group.id === selection.provider);
	const withSelection =
		selectedGroup === undefined
			? [
					...groups,
					{
						id: selection.provider,
						name: selection.provider,
						kind: 'anthropic' as const,
						baseUrl: null,
						models: [unlistedModel(selection.model)],
						ready: false,
						message: '',
					},
				]
			: selectedGroup.models.some((model) => model.id === selection.model)
				? groups
				: groups.map((group) =>
						group.id === selection.provider
							? { ...group, models: [...group.models, unlistedModel(selection.model)] }
							: group,
					);
	return withSelection
		.filter((group) => group.models.length > 0)
		.map((group) => ({
			...group,
			models: group.models.map((model) => ({
				...model,
				label: catalogModelLabel([...group.models, ...catalog], model.id),
			})),
		}));
}

export interface FlatPickerModel {
	readonly provider: string;
	readonly providerName: string;
	readonly model: AgentModelInfo;
}

export function flatPickerModels(
	groups: readonly ProviderGroup[],
	selection: ModelSelection,
): readonly FlatPickerModel[] {
	return pickerGroups(groups, selection).flatMap((group) =>
		group.models.map((model) => ({
			provider: group.id,
			providerName: group.name,
			model,
		})),
	);
}

export function filterPickerModels(
	rows: readonly FlatPickerModel[],
	query: string,
): readonly FlatPickerModel[] {
	const terms = query.toLowerCase().split(/\s+/u).filter(Boolean);
	if (terms.length === 0) return rows;
	return rows.filter((row) => {
		const text = `${row.model.label} ${row.model.id} ${row.providerName}`.toLowerCase();
		return terms.every((term) => text.includes(term));
	});
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
