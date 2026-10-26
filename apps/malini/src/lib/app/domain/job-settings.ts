import {
	DEFAULT_JOBS_MAX_CONCURRENT,
	JOBS_MAX_CONCURRENT_RANGE,
	JOBS_MAX_CONCURRENT_SETTING,
	JOBS_RECONCILER_SETTING,
	reconcilerMode,
	type ReconcilerMode,
} from '$contract/jobs';
import {
	DEFAULT_MERGE_QUEUE_FIX_ATTEMPTS,
	MERGE_QUEUE_FIX_ATTEMPTS_RANGE,
	MERGE_QUEUE_FIX_ATTEMPTS_SETTING,
	UPDATE_FROM_MAIN_TRIGGER_SETTING,
	updateFromMainTrigger,
	type UpdateFromMainTrigger,
} from '$contract/pull-requests';

export type JobSettingKey =
	typeof JOBS_MAX_CONCURRENT_SETTING | typeof MERGE_QUEUE_FIX_ATTEMPTS_SETTING;

export type JobSettingBounds = Readonly<{ min: number; max: number; fallback: number }>;

export type JobSettings = Readonly<
	Record<JobSettingKey, number> &
		Record<typeof UPDATE_FROM_MAIN_TRIGGER_SETTING, UpdateFromMainTrigger> &
		Record<typeof JOBS_RECONCILER_SETTING, ReconcilerMode>
>;

export const JOB_SETTING_BOUNDS: Readonly<Record<JobSettingKey, JobSettingBounds>> = {
	[JOBS_MAX_CONCURRENT_SETTING]: {
		...JOBS_MAX_CONCURRENT_RANGE,
		fallback: DEFAULT_JOBS_MAX_CONCURRENT,
	},
	[MERGE_QUEUE_FIX_ATTEMPTS_SETTING]: {
		...MERGE_QUEUE_FIX_ATTEMPTS_RANGE,
		fallback: DEFAULT_MERGE_QUEUE_FIX_ATTEMPTS,
	},
};

export function clampJobSetting(key: JobSettingKey, value: number): number {
	const { min, max, fallback } = JOB_SETTING_BOUNDS[key];
	if (!Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.round(value)));
}

export function jobSettingsFromStored(stored: Readonly<Record<string, string>>): JobSettings {
	return {
		[JOBS_MAX_CONCURRENT_SETTING]: storedJobSetting(JOBS_MAX_CONCURRENT_SETTING, stored),
		[MERGE_QUEUE_FIX_ATTEMPTS_SETTING]: storedJobSetting(MERGE_QUEUE_FIX_ATTEMPTS_SETTING, stored),
		[UPDATE_FROM_MAIN_TRIGGER_SETTING]: updateFromMainTrigger(
			stored[UPDATE_FROM_MAIN_TRIGGER_SETTING],
		),
		[JOBS_RECONCILER_SETTING]: reconcilerMode(stored[JOBS_RECONCILER_SETTING]),
	};
}

export function jobSettingFromInput(key: JobSettingKey, input: string, current: number): number {
	const value = Number(input);
	if (input.trim() === '' || !Number.isFinite(value)) return current;
	return clampJobSetting(key, value);
}

function storedJobSetting(key: JobSettingKey, stored: Readonly<Record<string, string>>): number {
	const raw = stored[key];
	if (raw === undefined || raw.trim() === '') return JOB_SETTING_BOUNDS[key].fallback;
	return clampJobSetting(key, Number(raw));
}
