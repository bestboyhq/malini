import { scheduleCadenceLabel, scheduleTime } from '$contract/automation-trigger';
import type {
	AutomationBuiltin,
	AutomationDefinitionRecord,
	AutomationTrigger,
} from '$contract/automations';
import { BUILTIN_AUTOMATIONS } from '$lib/automations/domain/builtin-automations';
import { scheduleOf } from '$lib/automations/domain/schedule';

export type UpdateFromMain = 'touches' | 'always' | 'never';

export type AutomationDefaults = Readonly<{
	resolveConflicts: boolean;
	addressReview: boolean;
	brain: boolean;
	updateFromMain: UpdateFromMain;
}>;

export type DefaultsChoice = 'recommended' | 'custom';

export type DefaultSwitch = 'resolveConflicts' | 'addressReview' | 'brain';

export type TriggerChange = Readonly<{
	definition: AutomationDefinitionRecord;
	trigger: AutomationTrigger;
}>;

type Definition = Pick<AutomationDefinitionRecord, 'builtin' | 'trigger'>;

export const RECOMMENDED: AutomationDefaults = {
	resolveConflicts: true,
	addressReview: true,
	brain: true,
	updateFromMain: 'touches',
};

export const UPDATE_FROM_MAIN_MODES: readonly UpdateFromMain[] = ['touches', 'always', 'never'];

const BASE_OVERLAPPED = 'on repositories:workstream-base-overlapped';
const OVERLAPPING_FILTER = 'where overlapping is true';
const BRAIN_BUILTINS: readonly AutomationBuiltin[] = ['capture-brain', 'write-brain-notes'];
const DEFAULT_BUILTINS: readonly AutomationBuiltin[] = [
	'resolve-conflicts',
	'address-review',
	'update-from-main',
	...BRAIN_BUILTINS,
];

function triggerOf(
	definitions: readonly Definition[],
	builtin: AutomationBuiltin,
): AutomationTrigger | null {
	return definitions.find((definition) => definition.builtin === builtin)?.trigger ?? null;
}

function isOn(definitions: readonly Definition[], builtin: AutomationBuiltin): boolean {
	return (triggerOf(definitions, builtin)?.mode ?? 'off') !== 'off';
}

export function updateFromMainMode(trigger: AutomationTrigger | null): UpdateFromMain {
	if (trigger === null || trigger.mode === 'off') return 'never';
	return trigger.when.includes(OVERLAPPING_FILTER) ? 'touches' : 'always';
}

export function liveDefaults(definitions: readonly Definition[]): AutomationDefaults {
	return {
		resolveConflicts: isOn(definitions, 'resolve-conflicts'),
		addressReview: isOn(definitions, 'address-review'),
		brain: isOn(definitions, 'capture-brain'),
		updateFromMain: updateFromMainMode(triggerOf(definitions, 'update-from-main')),
	};
}

export function sameDefaults(left: AutomationDefaults, right: AutomationDefaults): boolean {
	return (
		left.resolveConflicts === right.resolveConflicts &&
		left.addressReview === right.addressReview &&
		left.brain === right.brain &&
		left.updateFromMain === right.updateFromMain
	);
}

export function defaultsChoice(definitions: readonly Definition[]): DefaultsChoice {
	const automatic = DEFAULT_BUILTINS.every(
		(builtin) => triggerOf(definitions, builtin)?.mode === 'auto',
	);
	return automatic && sameDefaults(liveDefaults(definitions), RECOMMENDED)
		? 'recommended'
		: 'custom';
}

function defaultWhen(builtin: AutomationBuiltin, current: AutomationTrigger | null): string {
	return current?.when ?? BUILTIN_AUTOMATIONS[builtin].trigger?.when ?? '';
}

function switched(
	builtin: AutomationBuiltin,
	on: boolean,
	current: AutomationTrigger | null,
): AutomationTrigger {
	return { when: defaultWhen(builtin, current), mode: on ? 'auto' : 'off' };
}

function updateFromMainTrigger(
	mode: UpdateFromMain,
	current: AutomationTrigger | null,
): AutomationTrigger {
	if (mode === 'never') return switched('update-from-main', false, current);
	return {
		when: mode === 'touches' ? `${BASE_OVERLAPPED} ${OVERLAPPING_FILTER}` : BASE_OVERLAPPED,
		mode: 'auto',
	};
}

function wantedTrigger(
	builtin: AutomationBuiltin,
	defaults: AutomationDefaults,
	current: AutomationTrigger | null,
): AutomationTrigger | null {
	if (builtin === 'update-from-main')
		return updateFromMainTrigger(defaults.updateFromMain, current);
	if (builtin === 'resolve-conflicts') return switched(builtin, defaults.resolveConflicts, current);
	if (builtin === 'address-review') return switched(builtin, defaults.addressReview, current);
	return defaults.brain ? null : switched(builtin, false, current);
}

export function defaultsTriggerChanges(
	definitions: readonly AutomationDefinitionRecord[],
	defaults: AutomationDefaults,
): readonly TriggerChange[] {
	return DEFAULT_BUILTINS.flatMap((builtin): TriggerChange[] => {
		const definition = definitions.find((candidate) => candidate.builtin === builtin);
		if (!definition) return [];
		const trigger = wantedTrigger(builtin, defaults, definition.trigger);
		if (trigger === null) return [];
		const unchanged =
			trigger.when === definition.trigger?.when && trigger.mode === definition.trigger.mode;
		return unchanged ? [] : [{ definition, trigger }];
	});
}

export function scheduleLine(when: string | null | undefined): string | null {
	const schedule = scheduleOf(when);
	return schedule && `${scheduleCadenceLabel(schedule.cadence)} at ${scheduleTime(schedule)}`;
}
