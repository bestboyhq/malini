import type { BrowserBounds, BrowserPickArgs, BrowserTabArgs } from '$contract/browser';
import { isValidAgentModel, isValidAgentRunProfile } from '$shared/providers/providers.platform';

const MAX_PICK_MODELS = 64;
const MAX_MODEL_LABEL_CHARS = 80;

export function readWorkstreamId(args: unknown): string {
	const value = field(args, 'workstreamId');
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error('invalid args: `workstreamId` must be a non-empty string');
	}
	return value;
}

export function readTab(args: unknown): BrowserTabArgs {
	const tabId = field(args, 'tabId');
	if (typeof tabId !== 'string' || tabId.trim().length === 0) {
		throw new Error('invalid args: `tabId` must be a non-empty string');
	}
	return { workstreamId: readWorkstreamId(args), tabId };
}

export function readBounds(args: unknown): BrowserBounds {
	const bounds = field(args, 'bounds');
	const x = field(bounds, 'x');
	const y = field(bounds, 'y');
	const width = field(bounds, 'width');
	const height = field(bounds, 'height');
	if (
		!isFiniteNumber(x) ||
		!isFiniteNumber(y) ||
		!isFiniteNumber(width) ||
		!isFiniteNumber(height) ||
		width < 0 ||
		height < 0
	) {
		throw new Error(
			'invalid args: `bounds` needs finite `x`, `y`, `width` and `height`, no size below zero',
		);
	}
	return { x, y, width, height };
}

export function readRequestId(args: unknown): string {
	const value = field(args, 'requestId');
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error('invalid args: `requestId` must be a non-empty string');
	}
	return value;
}

export function readPick(args: unknown): BrowserPickArgs {
	const model = field(args, 'model');
	const models = field(args, 'models');
	const profile = field(args, 'profile');
	if (!isValidAgentModel(model)) throw new Error('invalid args: `model` must be a model id');
	if (
		!Array.isArray(models) ||
		models.length > MAX_PICK_MODELS ||
		!models.every(
			(choice) =>
				isValidAgentModel(field(choice, 'id')) &&
				typeof field(choice, 'label') === 'string' &&
				String(field(choice, 'label')).length <= MAX_MODEL_LABEL_CHARS,
		)
	) {
		throw new Error(
			`invalid args: \`models\` must list up to ${MAX_PICK_MODELS} models, each an \`id\` and a \`label\``,
		);
	}
	if (!isValidAgentRunProfile(profile))
		throw new Error('invalid args: `profile` must be a run profile');
	return {
		...readTab(args),
		model,
		models: models.map((choice) => ({
			id: String(field(choice, 'id')),
			label: String(field(choice, 'label')),
		})),
		profile,
	};
}

export function readUrl(args: unknown): string {
	const value = field(args, 'url');
	if (typeof value !== 'string') throw new Error('invalid args: `url` must be a string');
	return value;
}

function field(args: unknown, key: string): unknown {
	return typeof args === 'object' && args !== null ? Reflect.get(args, key) : undefined;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}
