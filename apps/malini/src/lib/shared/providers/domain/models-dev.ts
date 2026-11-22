import type { AgentModelInfo } from '$contract/agent';
import { isValidAgentModel } from './model-id';
import { isRecord } from './model-preferences';
import { AGENT_REASONING_EFFORTS, type AgentReasoningEffort } from './run-profile';

export const MODELS_DEV_URL = 'https://models.dev/api.json';

export const CLAUDE_CATALOG_ID = 'anthropic';

const MAX_MODELS = 200;
const MAX_LABEL_LENGTH = 80;
const MAX_FAMILY_LENGTH = 64;
const RELEASE_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const RELEASE_STAGES = new Set(['preview', 'beta', 'alpha', 'exp', 'experimental', 'latest']);

interface CatalogModel {
	readonly info: AgentModelInfo;
	readonly released: string;
}

export function modelsDevModels(catalog: unknown, providerId: string): AgentModelInfo[] {
	return newestFirst(catalog, providerId, ({ info }) => info.family ?? info.id).map(
		({ info }) => info,
	);
}

export function modelsDevVersions(catalog: unknown, providerId: string): AgentModelInfo[] {
	return newestFirst(catalog, providerId, ({ info }) => info.label).flatMap(({ info, released }) =>
		RELEASE_DATE.test(released) ? [{ ...info, released }] : [],
	);
}

function newestFirst(
	catalog: unknown,
	providerId: string,
	key: (model: CatalogModel) => string,
): CatalogModel[] {
	const provider = isRecord(catalog) ? catalog[providerId] : undefined;
	const models = isRecord(provider) ? provider['models'] : undefined;
	if (!isRecord(models)) return [];
	const seen = new Set<string>();
	return Object.values(models)
		.flatMap((model) => catalogModel(model) ?? [])
		.sort(
			(left, right) =>
				right.released.localeCompare(left.released) ||
				left.info.label.localeCompare(right.info.label) ||
				left.info.id.localeCompare(right.info.id),
		)
		.filter((model) => {
			const name = key(model);
			if (seen.has(name)) return false;
			seen.add(name);
			return true;
		})
		.slice(0, MAX_MODELS);
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
			description: modelDescription(
				strings(modalities['input']),
				isRecord(model['limit']) ? model['limit']['context'] : undefined,
			),
			efforts: model['reasoning'] === true ? efforts(model['reasoning_options']) : [],
			...(isFamily(family) ? { family: modelLine(family, label) } : {}),
		},
		released: typeof model['release_date'] === 'string' ? model['release_date'] : '',
	};
}

function shortName(name: string): string {
	const trimmed = name.trim();
	const short = trimmed
		.replace(/^Claude (?=\p{L})/u, '')
		.replace(/ \(latest\)$/u, '')
		.replace(/ \d{4}$/u, '');
	return short.length > 0 ? short : trimmed;
}

function modelLine(family: string, label: string): string {
	const known = new Set(family.toLowerCase().split('-'));
	const words = label
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((word) => /^\p{L}+$/u.test(word) && !RELEASE_STAGES.has(word) && !known.has(word));
	return [family, ...new Set(words)].join('-');
}

function isFamily(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= MAX_FAMILY_LENGTH;
}

function isFree(cost: unknown): boolean {
	return isRecord(cost) && cost['input'] === 0 && cost['output'] === 0;
}

export function modelDescription(input: readonly string[], context: unknown): string {
	const reads = input.includes('image') ? 'Text and images' : 'Text only';
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
