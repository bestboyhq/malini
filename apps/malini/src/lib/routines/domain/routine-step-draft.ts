import type {
	RoutineCommandRun,
	RoutineJsonValue,
	RoutineRun,
	RoutineStepKind,
	RoutineWorkflowRun,
} from './routine';

export type RoutineStepDraft = {
	key: string;
	kind: RoutineStepKind;
	job: string;
	command: string;
	args: string;
	workflow: string;
	input: string;
};

export function emptyRoutineStepDraft(key: string): RoutineStepDraft {
	return { key, kind: 'job', job: '', command: '', args: '[]', workflow: '', input: '{}' };
}

export function routineStepDraftFromRun(run: RoutineRun, key: string): RoutineStepDraft {
	const empty = emptyRoutineStepDraft(key);
	if ('job' in run) return { ...empty, job: run.job };
	if ('workflow' in run) {
		return {
			...empty,
			kind: 'workflow',
			workflow: run.workflow,
			input: JSON.stringify(run.input),
		};
	}
	return { ...empty, kind: 'command', command: run.command, args: JSON.stringify(run.args) };
}

export function routineRunFromStepDraft(draft: RoutineStepDraft, position: number): RoutineRun {
	const step = `Step ${position}`;
	if (draft.kind === 'job') {
		if (!draft.job.trim()) throw new Error(`${step}: choose the job to run.`);
		return { job: draft.job.trim() };
	}
	if (draft.kind === 'workflow') {
		if (!draft.workflow.trim()) throw new Error(`${step}: choose the workflow to run.`);
		return { workflow: draft.workflow.trim(), input: parseJsonObject(draft.input, step) };
	}
	if (!draft.command.trim()) throw new Error(`${step}: name the command to run.`);
	return { command: draft.command.trim(), args: parseJsonArray(draft.args, step) };
}

export function moveRoutineStep<Step>(
	steps: readonly Step[],
	index: number,
	offset: number,
): Step[] {
	const target = index + offset;
	const moving = steps[index];
	if (moving === undefined || target < 0 || target >= steps.length) return [...steps];
	const rest = steps.filter((_, position) => position !== index);
	return [...rest.slice(0, target), moving, ...rest.slice(target)];
}

function parseJsonObject(raw: string, step: string): RoutineWorkflowRun['input'] {
	if (!raw.trim()) return {};
	const parsed = parseJson(raw, `${step}: workflow input`);
	if (!isJsonRecord(parsed)) throw new Error(`${step}: workflow input must be a JSON object.`);
	return parsed;
}

function parseJsonArray(raw: string, step: string): RoutineCommandRun['args'] {
	if (!raw.trim()) return [];
	const parsed = parseJson(raw, `${step}: arguments`);
	if (!isJsonArray(parsed)) throw new Error(`${step}: arguments must be a JSON array.`);
	return parsed;
}

function parseJson(raw: string, subject: string): unknown {
	try {
		const parsed: unknown = JSON.parse(raw);
		return parsed;
	} catch {
		throw new Error(`${subject} is not valid JSON.`);
	}
}

function isJsonRecord(value: unknown): value is Readonly<Record<string, RoutineJsonValue>> {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		Object.values(value).every(isJsonValue)
	);
}

function isJsonArray(value: unknown): value is readonly RoutineJsonValue[] {
	return Array.isArray(value) && value.every(isJsonValue);
}

function isJsonValue(value: unknown): value is RoutineJsonValue {
	if (value === null) return true;
	if (Array.isArray(value)) return value.every(isJsonValue);
	if (typeof value === 'object') return Object.values(value).every(isJsonValue);
	return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}
