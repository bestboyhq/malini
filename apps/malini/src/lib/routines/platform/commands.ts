import { randomUUID } from 'node:crypto';
import { parseAutomationTrigger } from '$contract/automation-trigger';
import type {
	RoutineChange,
	RoutineChangedEvent,
	RoutineCommandName,
	RoutineEventChannel,
	RoutineEvidence,
	RoutineGatedRunChangedEvent,
	RoutineGatedRunRecord,
	RoutineGatedRunState,
	RoutineCommandRun,
	RoutineOrigin,
	RoutineRecord,
	RoutineRun,
	RoutineStatus,
	RoutineWorkflowRun,
	RoutineSuggestedEvent,
	RoutineSuggestionRecord,
} from '$contract/routines';
import type { MaliniDatabase } from '$main/db/driver';
import { isRecord, nowIso8601 } from '$main/db/rows';
import type { EventBus } from '$main/events';
import type { CommandRegistry } from '$main/ipc/registry';
import { ROUTINE_LABEL_MAX_LENGTH, ROUTINE_MAX_STEPS } from '../domain/routine';
import { ROUTINE_CLUSTER_MIN_PROMPT_TOKENS, promptTokenSet } from './prompt-clustering.service';
import {
	deleteRoutine,
	getGatedRun,
	getRoutine,
	getSuggestion,
	insertRoutine,
	decideGatedRun,
	listGatedRuns,
	listRoutines,
	listSuggestions,
	recordGatedRun,
	rejectPendingGatedRuns,
	setSuggestionStatus,
	updateRoutine,
	updateRoutineStatus,
} from './routines.repository';
import { requireRunnableSteps } from './event-triggers.service';

export const ROUTINE_EVENT_CHANNELS = {
	suggested: 'routines:suggested',
	changed: 'routines:changed',
	gatedRunChanged: 'routines:gated-run-changed',
} as const satisfies Record<string, RoutineEventChannel>;

export const ROUTINE_COMMAND_NAMES: readonly RoutineCommandName[] = [
	'routines.list',
	'routines.create-draft',
	'routines.update',
	'routines.promote',
	'routines.demote',
	'routines.delete',
	'routines.list-gated-runs',
	'routines.record-gated-run',
	'routines.confirm-run',
	'routines.reject-run',
	'routines.list-suggestions',
	'routines.dismiss-suggestion',
] as const;

const PROMOTIONS: Readonly<Partial<Record<RoutineStatus, RoutineStatus>>> = {
	draft: 'candidate',
	candidate: 'routine',
};

const DEMOTIONS: Readonly<Partial<Record<RoutineStatus, RoutineStatus>>> = {
	routine: 'candidate',
	candidate: 'draft',
};

export interface RoutineCommandDeps {
	readonly db: MaliniDatabase;
	readonly events: EventBus;
}

export function defineRoutineCommands(commands: CommandRegistry, deps: RoutineCommandDeps): void {
	const { db, events } = deps;

	const emitChanged = (
		routineId: string,
		change: RoutineChange,
		routine: RoutineRecord | null,
	): void => {
		const payload: RoutineChangedEvent = { routineId, change, routine };
		events.emit(ROUTINE_EVENT_CHANNELS.changed, payload);
	};

	const emitGatedRunChanged = (gatedRun: RoutineGatedRunRecord): void => {
		const payload: RoutineGatedRunChangedEvent = { gatedRun };
		events.emit(ROUTINE_EVENT_CHANNELS.gatedRunChanged, payload);
	};

	commands.define('routines.list', (): RoutineRecord[] => listRoutines(db));

	commands.define('routines.create-draft', (args: unknown): RoutineRecord => {
		const label = parseLabel(field(args, 'label'));
		const when = parseWhen(field(args, 'when'));
		const steps = parseSteps(field(args, 'steps'));
		requireRunnableSteps(when, steps);
		const suggestionId = optionalString(args, 'suggestionId');
		const now = nowIso8601();

		let origin = parseOrigin(field(args, 'origin')) ?? 'user';
		let evidence = parseEvidence(field(args, 'evidence')) ?? [];
		if (suggestionId !== null) {
			const suggestion = getSuggestion(db, suggestionId);
			if (!suggestion) throw new Error(`suggestion \`${suggestionId}\` not found`);
			origin = parseOrigin(field(args, 'origin')) ?? 'suggested';
			if (evidence.length === 0) evidence = suggestion.evidence;
			setSuggestionStatus(db, suggestionId, 'accepted', now);
		}

		const routine: RoutineRecord = {
			id: randomUUID(),
			status: 'draft',
			origin,
			label,
			when,
			steps,
			evidence,
			createdAt: now,
			updatedAt: now,
		};
		insertRoutine(db, routine);
		emitChanged(routine.id, 'created', routine);
		return routine;
	});

	commands.define('routines.update', (args: unknown): RoutineRecord => {
		const routineId = requireString(args, 'routineId');
		const routine = requireRoutine(db, routineId);
		const label = field(args, 'label');
		const when = field(args, 'when');
		const steps = field(args, 'steps');
		if (label === undefined && when === undefined && steps === undefined) {
			throw new Error('`routines.update` needs a label, when or steps to change');
		}
		const changes = {
			label: label === undefined ? routine.label : parseLabel(label),
			when: when === undefined ? routine.when : parseWhen(when),
			steps: steps === undefined ? routine.steps : parseSteps(steps),
		};
		requireRunnableSteps(changes.when, changes.steps);
		const updated = updateRoutine(db, routineId, changes, nowIso8601());
		emitChanged(routineId, 'updated', updated);
		return updated;
	});

	commands.define('routines.promote', (args: unknown): RoutineRecord => {
		const routineId = requireString(args, 'routineId');
		const routine = requireRoutine(db, routineId);
		const next = PROMOTIONS[routine.status];
		if (!next) throw new Error(`routine \`${routineId}\` is already a routine`);
		const updated = updateRoutineStatus(db, routineId, next, nowIso8601());
		emitChanged(routineId, 'promoted', updated);
		return updated;
	});

	commands.define('routines.demote', (args: unknown): RoutineRecord => {
		const routineId = requireString(args, 'routineId');
		const routine = requireRoutine(db, routineId);
		const next = DEMOTIONS[routine.status];
		if (!next) throw new Error(`routine \`${routineId}\` is already a draft`);
		const now = nowIso8601();
		if (routine.status === 'candidate') {
			for (const rejected of rejectPendingGatedRuns(db, routineId, now)) {
				emitGatedRunChanged(rejected);
			}
		}
		const updated = updateRoutineStatus(db, routineId, next, now);
		emitChanged(routineId, 'demoted', updated);
		return updated;
	});

	commands.define('routines.delete', (args: unknown): null => {
		const routineId = requireString(args, 'routineId');
		requireRoutine(db, routineId);
		deleteRoutine(db, routineId);
		emitChanged(routineId, 'deleted', null);
		return null;
	});

	commands.define('routines.list-gated-runs', (args: unknown): RoutineGatedRunRecord[] => {
		const state = field(args, 'state');
		if (state !== undefined && !isGatedRunState(state)) {
			throw new Error(`unknown gated run state \`${String(state)}\``);
		}
		return listGatedRuns(db, {
			...maybe('workstreamId', optionalString(args, 'workstreamId')),
			...(state !== undefined ? { state } : {}),
		});
	});

	commands.define('routines.record-gated-run', (args: unknown): RoutineGatedRunRecord => {
		const routineId = requireString(args, 'routineId');
		requireRoutine(db, routineId);
		const { record, created } = recordGatedRun(db, {
			id: requireString(args, 'id'),
			routineId,
			workstreamId: requireString(args, 'workstreamId'),
			runKey: requireString(args, 'runKey'),
			event: requireString(args, 'event'),
			payload: field(args, 'payload') ?? null,
			createdAt: nowIso8601(),
		});
		if (created) emitGatedRunChanged(record);
		return record;
	});

	commands.define('routines.confirm-run', (args: unknown): RoutineGatedRunRecord => {
		return decide(requireString(args, 'gatedRunId'), 'confirmed');
	});

	commands.define('routines.reject-run', (args: unknown): RoutineGatedRunRecord => {
		return decide(requireString(args, 'gatedRunId'), 'rejected');
	});

	commands.define('routines.list-suggestions', (): RoutineSuggestionRecord[] =>
		listSuggestions(db).filter(({ evidence }) =>
			evidence.every(({ text }) => promptTokenSet(text).size >= ROUTINE_CLUSTER_MIN_PROMPT_TOKENS),
		),
	);

	commands.define('routines.dismiss-suggestion', (args: unknown): RoutineSuggestionRecord => {
		const suggestionId = requireString(args, 'suggestionId');
		if (!getSuggestion(db, suggestionId)) {
			throw new Error(`suggestion \`${suggestionId}\` not found`);
		}
		return setSuggestionStatus(db, suggestionId, 'dismissed', nowIso8601());
	});

	function decide(gatedRunId: string, state: 'confirmed' | 'rejected'): RoutineGatedRunRecord {
		if (!getGatedRun(db, gatedRunId)) throw new Error(`gated run \`${gatedRunId}\` not found`);
		const { record, changed } = decideGatedRun(db, gatedRunId, state, nowIso8601());
		if (changed) emitGatedRunChanged(record);
		return record;
	}
}

export function emitSuggested(events: EventBus, suggestion: RoutineSuggestionRecord): void {
	const payload: RoutineSuggestedEvent = { suggestion };
	events.emit(ROUTINE_EVENT_CHANNELS.suggested, payload);
}

function requireRoutine(db: MaliniDatabase, routineId: string): RoutineRecord {
	const routine = getRoutine(db, routineId);
	if (!routine) throw new Error(`routine \`${routineId}\` not found`);
	return routine;
}

function field(args: unknown, key: string): unknown {
	return isRecord(args) ? args[key] : undefined;
}

function requireString(args: unknown, key: string): string {
	const value = field(args, key);
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`\`${key}\` must be a non-empty string`);
	}
	return value;
}

function optionalString(args: unknown, key: string): string | null {
	const value = field(args, key);
	if (value === undefined || value === null) return null;
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`\`${key}\` must be a non-empty string when present`);
	}
	return value;
}

function maybe<Key extends string>(key: Key, value: string | null): Partial<Record<Key, string>> {
	if (value === null) return {};
	const result: Partial<Record<Key, string>> = {};
	result[key] = value;
	return result;
}

function parseOrigin(value: unknown): RoutineOrigin | null {
	if (value === undefined || value === null) return null;
	if (value === 'user' || value === 'suggested') return value;
	throw new Error(`\`origin\` must be "user" or "suggested"`);
}

function isGatedRunState(value: unknown): value is RoutineGatedRunState {
	return value === 'pending' || value === 'confirmed' || value === 'rejected';
}

function parseLabel(value: unknown): string {
	const label = typeof value === 'string' ? value.trim() : '';
	if (label.length === 0 || label.length > ROUTINE_LABEL_MAX_LENGTH) {
		throw new Error(`\`label\` must be 1-${ROUTINE_LABEL_MAX_LENGTH} characters`);
	}
	return label;
}

function parseWhen(value: unknown): string {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error('`when` must be a non-empty string');
	}
	parseAutomationTrigger(value);
	return value.trim();
}

function parseSteps(value: unknown): readonly RoutineRun[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > ROUTINE_MAX_STEPS) {
		throw new Error(`\`steps\` must list 1-${ROUTINE_MAX_STEPS} steps`);
	}
	return value.map((step, index) => parseStep(step, `steps[${index}]`));
}

function parseStep(value: unknown, path: string): RoutineRun {
	if (!isRecord(value)) throw new Error(`\`${path}\` must be an object`);
	const kinds = ['workflow', 'command', 'job'].filter((kind) => Object.hasOwn(value, kind));
	if (kinds.length !== 1) {
		throw new Error(`\`${path}\` must select exactly one of workflow, command or job`);
	}
	if (Object.hasOwn(value, 'job')) {
		return { job: requireStepString(value['job'], `${path}.job`) };
	}
	if (Object.hasOwn(value, 'workflow')) {
		const input = value['input'] ?? {};
		if (!isRecord(input)) throw new Error(`\`${path}.input\` must be an object`);
		return {
			workflow: requireStepString(value['workflow'], `${path}.workflow`),
			input: asJson<RoutineWorkflowRun['input']>(input, `\`${path}.input\``),
		};
	}
	const commandArgs = value['args'] ?? [];
	if (!Array.isArray(commandArgs)) throw new Error(`\`${path}.args\` must be an array`);
	return {
		command: requireStepString(value['command'], `${path}.command`),
		args: asJson<RoutineCommandRun['args']>(commandArgs, `\`${path}.args\``),
	};
}

function requireStepString(value: unknown, path: string): string {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`\`${path}\` must be a non-empty string`);
	}
	return value.trim();
}

function parseEvidence(value: unknown): readonly RoutineEvidence[] | null {
	if (value === undefined || value === null) return null;
	if (!Array.isArray(value)) throw new Error('`evidence` must be an array');
	return value.map((entry, index) => {
		if (!isRecord(entry)) throw new Error(`\`evidence[${index}]\` must be an object`);
		if (entry['kind'] === 'prompt') {
			if (typeof entry['text'] !== 'string' || !entry['text'].trim()) {
				throw new Error(`\`evidence[${index}].text\` must be a non-empty string`);
			}
		} else if (entry['kind'] === 'run') {
			if (typeof entry['runId'] !== 'string' || !entry['runId'].trim()) {
				throw new Error(`\`evidence[${index}].runId\` must be a non-empty string`);
			}
		} else {
			throw new Error(`\`evidence[${index}].kind\` must be "prompt" or "run"`);
		}
		return asJson<RoutineEvidence>(entry, `\`evidence[${index}]\``);
	});
}

function asJson<Value>(value: unknown, what: string): Value;
function asJson(value: unknown, what: string): unknown {
	try {
		const parsed: unknown = JSON.parse(JSON.stringify(value));
		return parsed;
	} catch {
		throw new Error(`${what} must contain only JSON values`);
	}
}
