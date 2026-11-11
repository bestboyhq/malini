import {
	DEFAULT_AUTOMATIONS_MAX_CONCURRENT,
	AUTOMATIONS_MAX_CONCURRENT_RANGE,
	AUTOMATIONS_MAX_CONCURRENT_SETTING,
} from '$contract/automations';
import {
	DEFAULT_MERGE_QUEUE_FIX_ATTEMPTS,
	MERGE_QUEUE_FIX_ATTEMPTS_RANGE,
	MERGE_QUEUE_FIX_ATTEMPTS_SETTING,
} from '$contract/pull-requests';
import { automationsMaxConcurrent } from '$lib/automations/domain/automation-run';
import { clampedFixAttempts } from '$lib/pull-requests/domain/shipping';

export type AutomationSettingKey =
	typeof AUTOMATIONS_MAX_CONCURRENT_SETTING | typeof MERGE_QUEUE_FIX_ATTEMPTS_SETTING;

export type AutomationSettingBounds = Readonly<{ min: number; max: number; fallback: number }>;

export type AutomationSettings = Readonly<Record<AutomationSettingKey, number>>;

export const AUTOMATION_SETTING_BOUNDS: Readonly<
	Record<AutomationSettingKey, AutomationSettingBounds>
> = {
	[AUTOMATIONS_MAX_CONCURRENT_SETTING]: {
		...AUTOMATIONS_MAX_CONCURRENT_RANGE,
		fallback: DEFAULT_AUTOMATIONS_MAX_CONCURRENT,
	},
	[MERGE_QUEUE_FIX_ATTEMPTS_SETTING]: {
		...MERGE_QUEUE_FIX_ATTEMPTS_RANGE,
		fallback: DEFAULT_MERGE_QUEUE_FIX_ATTEMPTS,
	},
};

export function clampAutomationSetting(key: AutomationSettingKey, value: number): number {
	return key === MERGE_QUEUE_FIX_ATTEMPTS_SETTING
		? clampedFixAttempts(String(value))
		: automationsMaxConcurrent(String(value));
}

export function automationSettingsFromStored(
	stored: Readonly<Record<string, string>>,
): AutomationSettings {
	return {
		[AUTOMATIONS_MAX_CONCURRENT_SETTING]: storedAutomationSetting(
			AUTOMATIONS_MAX_CONCURRENT_SETTING,
			stored,
		),
		[MERGE_QUEUE_FIX_ATTEMPTS_SETTING]: storedAutomationSetting(
			MERGE_QUEUE_FIX_ATTEMPTS_SETTING,
			stored,
		),
	};
}

export function automationSettingFromInput(
	key: AutomationSettingKey,
	input: string,
	current: number,
): number {
	const value = Number(input);
	if (input.trim() === '' || !Number.isFinite(value)) return current;
	return clampAutomationSetting(key, value);
}

function storedAutomationSetting(
	key: AutomationSettingKey,
	stored: Readonly<Record<string, string>>,
): number {
	const raw = stored[key];
	if (raw === undefined || raw.trim() === '') return AUTOMATION_SETTING_BOUNDS[key].fallback;
	return clampAutomationSetting(key, Number(raw));
}
