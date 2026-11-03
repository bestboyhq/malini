import type { AgentModelInfo } from '$contract/agent';
import { isValidAgentModel } from './model-id';
import { isRecord } from './model-preferences';
import { AGENT_REASONING_EFFORTS, type AgentReasoningEffort } from './run-profile';

export const MODELS_DEV_URL = 'https://models.dev/api.json';

const MAX_MODELS = 200;
const MAX_LABEL_LENGTH = 80;
const MAX_FAMILY_LENGTH = 64;

interface CatalogModel {
	readonly info: AgentModelInfo;
	readonly released: string;
}

export function modelsDevModels(catalog: unknown, providerId: string): AgentModelInfo[] {
	const provider = isRecord(catalog) ? catalog[providerId] : undefined;
	const models = isRecord(provider) ? provider['models'] : undefined;
	if (!isRecord(models)) return [];
	const families = new Set<string>();
	return Object.values(models)
		.flatMap((model) => catalogModel(model) ?? [])
		.sort(
			(left, right) =>
				right.released.localeCompare(left.released) ||
				left.info.label.localeCompare(right.info.label),
		)
		.filter(({ info }) => {
			const family = info.family ?? info.id;
			if (families.has(family)) return false;
			families.add(family);
			return true;
		})
		.slice(0, MAX_MODELS)
		.map(({ info }) => info);
}

function catalogModel(model: unknown): CatalogModel | null {
	if (!isRecord(model)) return null;
	const { id, name, family, status, tool_call: toolCall } = model;
	if (!isValidAgentModel(id) || typeof name !== 'string') return null;
	if (status === 'deprecated' || toolCall !== true || isFree(model['cost'])) return null;
	const modalities = isRecord(model['modalities']) ? model['modalities'] : {};
	if (!strings(modalities['output']).includes('text')) return null;
	const label = shortName(name).slice(0, MAX_LABEL_LENGTH);
	return {
		info: {
			id,
			label: label.length > 0 ? label : id,
			description: describe(strings(modalities['input']), model['limit']),
			efforts: model['reasoning'] === true ? efforts(model['reasoning_options']) : [],
			...(isFamily(family) ? { family } : {}),
		},
		released: typeof model['release_date'] === 'string' ? model['release_date'] : '',
	};
}

function shortName(name: string): string {
	const trimmed = name.trim();
	const short = trimmed.replace(/^Claude (?=\p{L})/u, '').replace(/ \d{4}$/u, '');
	return short.length > 0 ? short : trimmed;
}

function isFamily(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= MAX_FAMILY_LENGTH;
}

function isFree(cost: unknown): boolean {
	return isRecord(cost) && cost['input'] === 0 && cost['output'] === 0;
}

function describe(input: readonly string[], limit: unknown): string {
	const reads = input.includes('image') ? 'Text and images' : 'Text only';
	const context = isRecord(limit) ? limit['context'] : undefined;
	if (typeof context !== 'number' || !Number.isFinite(context) || context <= 0) return reads;
	return `${reads}, ${tokens(context)} context`;
}

function tokens(count: number): string {
	return count >= 1_000_000
		? `${Math.round(count / 1_000_000)}M`
		: `${Math.max(1, Math.round(count / 1_000))}K`;
}

function efforts(options: unknown): AgentReasoningEffort[] {
	const offered = new Set(
		(Array.isArray(options) ? options : []).flatMap((option) =>
			isRecord(option) && option['type'] === 'effort' ? strings(option['values']) : [],
		),
	);
	return AGENT_REASONING_EFFORTS.filter((effort) => offered.has(effort));
}

function strings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === 'string')
		: [];
}
