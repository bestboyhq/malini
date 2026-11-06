import type { AgentModelInfo } from '$contract/agent';
import { AGENT_MODELS } from './model-id';
import type { ModelSelection } from './model-preferences';
import type { ProviderGroup } from './provider';
import { AGENT_REASONING_EFFORTS, type AgentReasoningEffort } from './run-profile';

export type { AgentModelInfo };

const CLAUDE_FAMILIES = ['claude-opus', 'claude-fable', 'claude-sonnet', 'claude-haiku'];

const MODEL_DESCRIPTIONS: Readonly<Record<string, string>> = {
	'claude-fable': 'For problems that fight back',
	'claude-opus': 'Does the real work. Usually right',
	'claude-sonnet': 'Routine work, no drama, less usage',
	'claude-haiku': "Fast. Don't ask it to ponder",
	'deepseek-thinking': 'Thinks hard. Text only',
	'deepseek-flash': 'Quick, and it can see',
};

export interface PickerRunner {
	readonly group: ProviderGroup;
	readonly model: AgentModelInfo;
}

export interface PickerRow {
	readonly family: string;
	readonly label: string;
	readonly description: string;
	readonly runners: readonly [PickerRunner, ...PickerRunner[]];
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
	const row = pickerRows(groups, selection).find((candidate) => rowRuns(candidate, selection));
	return row?.label ?? modelLabel(selection.model);
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
						...unknownGroup(selection.provider),
						models: [unlistedModel(selection.model, catalog)],
					},
				]
			: selectedGroup.models.some((model) => model.id === selection.model)
				? groups
				: groups.map((group) =>
						group.id === selection.provider
							? { ...group, models: [...group.models, unlistedModel(selection.model, catalog)] }
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

export function modelFamily(group: ProviderGroup, model: AgentModelInfo): string {
	if (model.family) return model.family;
	if (group.kind !== 'claude') return model.id;
	const [name] = model.id.replace(/^claude-/u, '').split(/[-[]/u);
	return `claude-${name ?? model.id}`;
}

export function pickerRows(
	groups: readonly ProviderGroup[],
	selection: ModelSelection,
): readonly PickerRow[] {
	const families = new Map<string, [PickerRunner, ...PickerRunner[]]>();
	for (const group of groups) {
		const seen = new Set<string>();
		for (const model of group.models) {
			const family = modelFamily(group, model);
			if (seen.has(family)) continue;
			seen.add(family);
			const runners = families.get(family);
			if (runners) runners.push({ group, model });
			else families.set(family, [{ group, model }]);
		}
	}
	const rows = [...families]
		.map(([family, runners]) => pickerRow(family, runners, selection))
		.sort((left, right) => claudeRank(left.family) - claudeRank(right.family));
	return rows.some((row) => rowRuns(row, selection))
		? rows
		: withSelection(rows, groups, selection);
}

export function runs(runner: PickerRunner, selection: ModelSelection): boolean {
	return runner.group.id === selection.provider && runner.model.id === selection.model;
}

export function rowRuns(row: PickerRow, selection: ModelSelection): boolean {
	return row.runners.some((runner) => runs(runner, selection));
}

export function rowRunner(
	row: PickerRow,
	selection: ModelSelection,
	ready: (runner: PickerRunner) => boolean,
): PickerRunner {
	return (
		row.runners.find((runner) => runs(runner, selection)) ??
		row.runners.find(ready) ??
		row.runners[0]
	);
}

export function filterPickerRows(rows: readonly PickerRow[], query: string): readonly PickerRow[] {
	const terms = query.toLowerCase().split(/\s+/u).filter(Boolean);
	if (terms.length === 0) return rows;
	return rows.filter((row) => {
		const runners = row.runners.map((runner) => `${runner.model.id} ${runner.group.name}`);
		const text = `${row.label} ${runners.join(' ')}`.toLowerCase();
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
	return AGENT_MODELS.map((id) => unlistedModel(id));
}

function unlistedModel(id: string, catalog: readonly AgentModelInfo[] = []): AgentModelInfo {
	return {
		id,
		label: catalogModelLabel(catalog, id),
		description: '',
		efforts: [...AGENT_REASONING_EFFORTS],
	};
}

function pickerRow(
	family: string,
	runners: readonly [PickerRunner, ...PickerRunner[]],
	selection: ModelSelection,
): PickerRow {
	const selected = runners.find((runner) => runs(runner, selection));
	const named =
		(selected?.group.kind === 'claude' ? undefined : selected) ??
		runners.find((runner) => runner.group.kind !== 'claude' && runner.group.ready) ??
		runners.find((runner) => runner.group.kind !== 'claude') ??
		runners[0];
	return {
		family,
		label: catalogModelLabel([named.model], named.model.id),
		description: MODEL_DESCRIPTIONS[family] ?? named.model.description,
		runners,
	};
}

function withSelection(
	rows: readonly PickerRow[],
	groups: readonly ProviderGroup[],
	selection: ModelSelection,
): readonly PickerRow[] {
	const group =
		groups.find((candidate) => candidate.id === selection.provider) ??
		unknownGroup(selection.provider);
	const model =
		group.models.find((candidate) => candidate.id === selection.model) ??
		unlistedModel(selection.model, allProviderModels(groups));
	const family = modelFamily(group, model);
	const row: PickerRow = {
		family: `${selection.provider}:${selection.model}`,
		label: catalogModelLabel([model], model.id),
		description: model.description,
		runners: [{ group, model }],
	};
	const at = rows.findIndex((candidate) => candidate.family === family);
	return at === -1 ? [...rows, row] : [...rows.slice(0, at + 1), row, ...rows.slice(at + 1)];
}

function unknownGroup(provider: string): ProviderGroup {
	return {
		id: provider,
		name: provider,
		kind: 'anthropic',
		baseUrl: null,
		models: [],
		ready: false,
		message: '',
		account: null,
	};
}

function claudeRank(family: string): number {
	const rank = CLAUDE_FAMILIES.indexOf(family);
	return rank === -1 ? CLAUDE_FAMILIES.length : rank;
}
